const { execSync } = require('child_process');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('.claude/ralph.config.json', 'utf8'));

if (!config.active) process.exit(0);

const counterFile = '.claude/ralph.iterations.json';
let counter = { count: 0, phaseIndex: 0 };
if (fs.existsSync(counterFile)) {
  counter = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
}

const phase = config.phases
  ? config.phases[counter.phaseIndex]
  : { milestone: config.milestone, branch: config.branch };

if (!phase) {
  console.log('🎉 All phases completed.');
  process.exit(0);
}

if (counter.count >= config.maxIterations) {
  console.log(`⛔ Iteration limit (${config.maxIterations}) reached.`);
  fs.writeFileSync(
    counterFile,
    JSON.stringify({ count: 0, phaseIndex: counter.phaseIndex }),
  );
  process.exit(0);
}

const issues = JSON.parse(
  execSync(
    `gh issue list --milestone "${phase.milestone}" --state open --json number,title`,
  ).toString(),
);

if (issues.length > 0) {
  counter.count++;
  fs.writeFileSync(counterFile, JSON.stringify(counter));

  const next = issues[0];
  console.log(
    `🔄 Phase ${counter.phaseIndex + 1} — Iteration ${counter.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`,
  );
  console.log(`📋 Remaining: ${issues.length}`);

  const prompt = config.prompt
    .replace('{milestone}', phase.milestone)
    .replace('{branch}', phase.branch);

  execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, {
    stdio: 'inherit',
  });
} else {
  console.log(`✅ Phase ${counter.phaseIndex + 1} completed. Creating PR...`);
  execSync(
    `claude -p "Create a PR from branch ${phase.branch} into main titled 'feat: ${phase.milestone}'." --model opus --max-turns 10`,
    { stdio: 'inherit' },
  );

  console.log('🔍 Opus review...');
  execSync(
    `claude -p "Find the latest open PR and perform a detailed code review. Check architecture, security, performance, and PRD compliance. Leave comments on the PR via gh cli." --model opus --max-turns ${config.maxTurns}`,
    { stdio: 'inherit' },
  );

  counter.phaseIndex++;
  counter.count = 0;
  fs.writeFileSync(counterFile, JSON.stringify(counter));

  const nextPhase = config.phases ? config.phases[counter.phaseIndex] : null;
  if (!nextPhase) {
    console.log('🎉 All phases completed!');
    process.exit(0);
  }

  console.log(`➡️ Phase ${counter.phaseIndex + 1}: ${nextPhase.milestone}`);
  const prompt = config.prompt
    .replace('{milestone}', nextPhase.milestone)
    .replace('{branch}', nextPhase.branch);

  execSync(`claude -p "${prompt}" --max-turns ${config.maxTurns}`, {
    stdio: 'inherit',
  });
}
