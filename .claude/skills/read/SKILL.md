---
name: read
description: Read a file or part of a file efficiently without wasting tokens. Use when only one function, class, model or field is needed rather than a whole file.
---

# Read File

Read $ARGUMENTS efficiently:

1. If a whole file is provided, inspect its structure first: `head -50 {file}`
2. Find the relevant section with grep: `grep -n "function|class|export" {file}`
3. Read only the necessary lines: `sed -n 'N,Mp' {file}`
4. For JSON files, use jq: `cat {file} | jq '.required_field'`
5. For a Prisma schema, read only the required model: `sed -n '/model {Name}/,/^}/p' {file}`

Never read the entire file if you only need a single function or model.
