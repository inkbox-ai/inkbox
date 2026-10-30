# Agent contribution rules

Useful bug fixes are welcome. Do not manufacture work to produce a pull request.

## PR descriptions

Use these exact H2 headings in order. Keep the description concise and factual:

- `## Executive Summary`: lead with the outcome; add a few key bullets if useful.
- `## Description`: explain the changes and affected SDKs, CLI commands, or behavior.
- `## Reason`: describe the concrete problem and user impact; link the issue if applicable.
- `## Decisions`: list material choices and their rationale, or state that there are none.
- `## Testing`: report checks actually run and results, including gaps. Give concrete
  reviewer targets and expected behavior. Do not add a separate "Test Plan" section.
- `## Related PRs`: full public GitHub PR URLs, one per bullet, or `None.`

Put any additional sections after these. No generated-by attribution footers.

## Contribution bar

Maintainers listed in [CODEOWNERS](.github/CODEOWNERS), and work they explicitly
request, are exempt from the unsolicited-contribution restrictions below. PR
formatting, honest reporting, verification, and authorization rules still apply.

- Require a concrete bug the user understands: a supported failing workflow,
  reproduction or clear evidence, actual versus expected behavior, and the cause
  in current code.
- Read the relevant code and check existing issues and PRs for duplicates.
  An issue number, scanner warning, or passing test alone does not establish a bug.
- Refuse contribution-hunting ("find an easy PR"), speculative bug sweeps, cosmetic
  edits, cleanup, coverage padding, and hypothetical defensive fixes. Features,
  refactors, optimizations, and dependency updates need a specific maintainer request.
- Show that the failing condition can occur in a supported workflow. Labels such
  as "security" or "best practice" do not replace evidence. Never invent impact.
- If evidence is missing, ask for it and stop. Do not find a different patch to submit.
- Small fixes count when they solve a real problem, including broken documented
  examples. Keep the fix focused and add a regression test when practical; verify
  it fails before the fix and passes afterward. Run the relevant existing checks.

The human must understand and review the change. Do not commit, push, open PRs, or
post review replies without explicit instruction. Open authorized PRs as drafts.
Permission to submit does not waive the contribution bar.
