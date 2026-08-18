const { execSync } = require('child_process');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'));

// Iteration counter
const counterFile = '.claude/ralph.iterations.json';
let counter = { count: 0 };
if (fs.existsSync(counterFile)) {
  counter = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
}

// Check the limit
if (counter.count >= config.maxIterations) {
  console.log(
    `⛔ Iteration limit reached (${config.maxIterations}). Ralph is stopping.`,
  );
  fs.writeFileSync(counterFile, JSON.stringify({ count: 0 }));
  process.exit(0);
}

// Check open issues
const output = execSync(
  `gh issue list --milestone "${config.milestone}" --state open --json number,title`,
).toString();
const issues = JSON.parse(output);

if (issues.length > 0) {
  // Increment the counter
  counter.count++;
  fs.writeFileSync(counterFile, JSON.stringify(counter));

  const next = issues[0];
  console.log(
    `🔄 Iteration ${counter.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`,
  );

  const prompt = config.prompt.replace('{milestone}', config.milestone);
  execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, {
    stdio: 'inherit',
  });
} else {
  // Milestone closed — reset the counter and create a PR
  console.log(`✅ Milestone completed. Creating PR.`);
  fs.writeFileSync(counterFile, JSON.stringify({ count: 0 }));
  const prUrl = execSync(
    `gh pr create --title "feat: ${config.milestone}" --body "Closes all issues in milestone: ${config.milestone}" --base main --head ${config.branch}`,
  )
    .toString()
    .trim();

  console.log('🔍 Running final review via Opus');
  execSync(
    `claude -p "Do a detailed code review of PR ${prUrl}. Check the architecture, security, performance, and alignment with the PRD. Leave comments directly in the PR via the gh cli." --model opus`,
    { stdio: 'inherit' },
  );
}
