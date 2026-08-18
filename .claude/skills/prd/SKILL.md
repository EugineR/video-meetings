---
name: prd
description: I create a PRD document for a feature using the standard project structure. I use it when I need to describe the requirements for a new feature before implementation.
---

# PRD Generator

Create a PRD (Product Requirements Document) for the following feature: $ARGUMENTS

Save the result to the file 'docs/{feature}/prd.md', where {feature} is $ARGUMENTS in English, kebab-case (for example: `docs/user-profile-page-and-editing/prd.md`).

Documentation in /docs is grouped per feature: one folder per feature, holding `prd.md`, `plan.md` and any research notes. Create the /docs folder and the feature folder if they don't exist.

## Language

The PRD file is always written in English — the whole document, including the feature name, all prose, and every list item — regardless of the language of $ARGUMENTS or of the conversation. Translate the feature description into English rather than mirroring its original language.

Clarifying questions and the summary you report back to the user stay in the language of the conversation; only the file content is fixed to English.

## Structure of document

# PRD: {name of the feature}

**Date**: {current date}
**Status**: Draft

## Goal

One-two sentences, about what is that and why it we need it

## Scenario

- User {action} -> {result}

## In scope

Everything what is included in the feature - specific list

## Out of scope

Everything that we don't do in this iteration.

## Technical constraints

All know constraings, that we must to consider

## Acceptance criteria

- [ ] Criteria 1
- [ ] Criteria 2

## Rules

- Be specific - no fluff.
- Readiness criteria must be verifiable.
- Don't describe how to implement - just what and why.
- If the description is short, ask clarifying questions to ensure full understanding before creating the file.
