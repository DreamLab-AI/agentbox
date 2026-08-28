# Forum feature-suggestion handoffs (dream-forum-suggestions tenant)

Mined nightly from the community feature-suggestions thread. `action` rows are
candidates for the next engineering night of the target repo; `defer` rows need
the operator. Nothing here merges or ships without the human gate.

| Date | Event | Author | Decision | Target | Suggestion | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-28 | 076e71cb493f | a3af4977 | action | agentbox | Creating DM messages is under the fold!! Remove unnecessary padding | Pure UI spacing/layout fix to bring DM composition above the fold; low-risk, no sensitive surfaces touched. |
| 2026-08-28 | 9510d756f10a | a3af4977 | action | forum | Enable Emoji reactions for other posts | Low-risk forum quality-of-life UI feature with no auth, privacy, or governance surface, ideal for an engineering-night handoff. |
| 2026-08-28 | 1340bac15df8 | a3af4977 | action | dreamlab-ai-website | Click on users name / avatar for committed in view & user info | Pure UI quality-of-life feature — clickable avatar/name revealing a user info card and their commits in the current view — with no auth, key, relay, or mesh surface involved. |
| 2026-08-28 | a89650ce24bf | a3af4977 | action | forum | Click on users name / avatar for zoomed in view of avatar & user info | Pure UI quality-of-life change with no auth, privacy-filtering, key, or write-authority surface; safe to queue as a dream-cycle handoff. |
| 2026-08-28 | 23869d8c0783 | a3af4977 | defer | agentbox | Give users the ability to add emojis for all users. Look at his this is specced out in slack | Platform-wide custom emoji involves upload infrastructure, moderation policy, and scope/cost decisions that need the operator, not an overnight queue. |
| 2026-08-28 | d1330029a13c | a3af4977 | action | forum | Enable Emoji reactions for others posts | Pure forum UI quality-of-life feature with no auth, key, relay, or agent-authority surface; ideal dream-cycle handoff candidate. |
| 2026-08-28 | 21debe291252 | a3af4977 | reject | forum | Feature Requests - add things that you want to see to this thread. | This is just the thread's generic starter prompt with no actual feature described, so there is nothing concrete to triage. |
| 2026-08-28 | b1a46ba24f9c | a3af4977 | reject | forum | @junkyjarvis can you action these, and marked them when done? | The post contains no actual suggestion — it references unspecified items ('these') with no content, so there is nothing to triage until the user reposts the concrete feature items. |
