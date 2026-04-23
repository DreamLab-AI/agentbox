Run `lazy bp $ARGUMENTS`. If no arguments given, run `lazy bp list` to show available blueprints.

Blueprint selection guide:
- Bug, error, crash, broken → `lazy bp run fix-bug "<description>"`
- New feature, add, implement, build → `lazy bp run add-feature "<description>"`
- Try, experiment, what if, spike → `lazy bp run experiment "<description>"`
- Review, audit, check code quality → `lazy bp run review-code "<scope>"`

Follow any agentic prompts returned by the blueprint execution in order. Each prompt is a step in a structured workflow.