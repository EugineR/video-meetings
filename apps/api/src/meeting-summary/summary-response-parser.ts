/** One action item extracted from a transcript: free-text description plus an optional assignee. */
export interface ActionItemPayload {
  description: string;
  assignee?: string;
}

/** The structured result `MeetingSummaryService.summarize` produces from a transcript. */
export interface SummaryGenerationResult {
  summaryText: string;
  actionItems: ActionItemPayload[];
  decisions: string[];
}

/** Strips a ```json ... ``` (or bare ``` ... ```) fence Claude sometimes wraps its reply in, despite being asked for raw JSON. */
function stripCodeFence(reply: string): string {
  const trimmed = reply.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function fail(reason: string, reply: string): never {
  const preview = reply.length > 500 ? `${reply.slice(0, 500)}...` : reply;
  throw new Error(
    `Failed to parse meeting summary response: ${reason}. Raw reply: ${preview}`,
  );
}

/**
 * Parses and validates Claude's reply to the summary-generation prompt into a
 * `SummaryGenerationResult`. Throws a descriptive `Error` (including a preview of the raw reply)
 * when the reply isn't valid JSON or doesn't match the expected shape, so the caller
 * (`MeetingSummaryService.generateForMeeting`) can catch it and mark the run `FAILED` rather than
 * persisting garbage.
 */
export function parseSummaryReply(reply: string): SummaryGenerationResult {
  const jsonText = stripCodeFence(reply);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    fail(err instanceof Error ? err.message : 'invalid JSON', reply);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('expected a JSON object', reply);
  }
  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.summaryText !== 'string') {
    fail('"summaryText" is missing or not a string', reply);
  }

  if (!Array.isArray(candidate.actionItems)) {
    fail('"actionItems" is missing or not an array', reply);
  }
  const actionItems: ActionItemPayload[] = candidate.actionItems.map(
    (item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        fail(`"actionItems[${index}]" is not an object`, reply);
      }
      const entry = item as Record<string, unknown>;
      if (typeof entry.description !== 'string' || entry.description === '') {
        fail(
          `"actionItems[${index}].description" is missing or not a non-empty string`,
          reply,
        );
      }
      if (
        entry.assignee !== undefined &&
        (typeof entry.assignee !== 'string' || entry.assignee === '')
      ) {
        fail(
          `"actionItems[${index}].assignee" must be a non-empty string when present`,
          reply,
        );
      }
      return entry.assignee
        ? { description: entry.description, assignee: entry.assignee }
        : { description: entry.description };
    },
  );

  if (!Array.isArray(candidate.decisions)) {
    fail('"decisions" is missing or not an array', reply);
  }
  const decisions = candidate.decisions.map((decision, index) => {
    if (typeof decision !== 'string' || decision === '') {
      fail(`"decisions[${index}]" is not a non-empty string`, reply);
    }
    return decision;
  });

  return { summaryText: candidate.summaryText, actionItems, decisions };
}
