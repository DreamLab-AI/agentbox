# In-context-learning exemplars

Three worked exemplars. Each shows the branch set, the fresh-kernel execution of
every candidate, the assertion-pass scoring, and the selection — including the
tie-break and the spend-cap halt paths.

## Exemplar 1 — correctness-critical edge case; best branch wins on pass count

**Task**: Implement `roman_to_int(s)` correctly, including the six subtractive
forms (IV, IX, XL, XC, CD, CM). Discriminating assertions provided.

**Step 1 — generate N=3 candidates via `sparc:coder`** (varied framing).

- **Candidate A** (naive sum — ignores subtraction):
  ```python
  def roman_to_int(s):
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      return sum(m[c] for c in s)
  ```
- **Candidate B** (subtractive lookahead):
  ```python
  def roman_to_int(s):
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      total = 0
      for i, c in enumerate(s):
          if i+1 < len(s) and m[c] < m[s[i+1]]:
              total -= m[c]
          else:
              total += m[c]
      return total
  ```
- **Candidate C** (pair-replace, but drops a case):
  ```python
  def roman_to_int(s):
      s = s.replace('IV','IIII').replace('IX','VIIII').replace('XL','XXXX')
      m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}
      return sum(m[c] for c in s)  # missing XC/CD/CM expansions
  ```

**Step 2–3 — fresh kernel per branch, run the shared assertion battery.**

```
Tool: code-interpreter.kernel.reset      # branch A
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate A>\nchecks=[('III',3),('IV',4),('IX',9),('LVIII',58),('MCMXCIV',1994)]\np=sum(1 for s,v in checks if roman_to_int(s)==v)\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 2/5\n", "exception": null, "duration_ms": 3 }
```
```
Tool: code-interpreter.kernel.reset      # branch B
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate B>\n<same checks>\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 5/5\n", "exception": null, "duration_ms": 3 }
```
```
Tool: code-interpreter.kernel.reset      # branch C
Tool: code-interpreter.kernel.exec
Args: { "code": "<candidate C>\n<same checks>\nprint(f'passed {p}/{len(checks)}')" }
Trace: { "stdout": "passed 3/5\n", "exception": null, "duration_ms": 4 }
```

**Step 4–5 — score and select.**

| Branch | Assertion-pass | Exception-free | Lines | Score |
|---|---|---|---|---|
| A | 2/5 | yes | 3 | 2 |
| **B** | **5/5** | **yes** | 8 | **5 ← chosen** |
| C | 3/5 | yes | 4 | 3 |

Candidate B is selected on pass count (5 vs 3 vs 2). No tie-break needed. The
naive branch A that "looked reasonable" is rejected by the trace, not by
inspection — Trace-as-Reward.

**Step 7 — audit:** `{run: "urn:agentbox:tree-search:<scope>:<run-id>",
n_candidates: 3, chosen_id: "B", scores: [2,5,3], halted: false}`.

---

## Exemplar 2 — two correct branches; tie-break on shortest code

**Task**: `is_power_of_two(n)` for `n >= 1`. Assertions cover 1, 2, 3, 1024, 1023.

**Step 1 — N=3 candidates.**

- **Candidate A** (loop divide):
  ```python
  def is_power_of_two(n):
      while n > 1:
          if n % 2: return False
          n //= 2
      return n == 1
  ```
- **Candidate B** (bit trick, one line):
  ```python
  def is_power_of_two(n):
      return n >= 1 and (n & (n - 1)) == 0
  ```
- **Candidate C** (float log — fails on precision):
  ```python
  import math
  def is_power_of_two(n):
      return math.log2(n).is_integer()
  ```

**Step 2–3 — run each in a fresh kernel.**

```
branch A → Trace.stdout "passed 5/5"   exception null   lines 6
branch B → Trace.stdout "passed 5/5"   exception null   lines 2
branch C → Trace.stdout "passed 4/5"   exception null   lines 3   # log2(large 2^k) rounds
```

**Step 4–5 — score, then tie-break.**

| Branch | Assertion-pass | Lines | Note |
|---|---|---|---|
| A | 5/5 | 6 | tie on pass count |
| **B** | **5/5** | **2** | **chosen — shortest of the tied pair** |
| C | 4/5 | 3 | eliminated on pass count |

A and B tie at 5/5. Step 5's tie-break selects the shortest code → **Candidate
B** (2 lines vs 6). Candidate C is eliminated earlier: `math.log2` loses
precision on large powers, so its trace shows 4/5, not a tie.

**Step 7 — audit:** `{n_candidates: 3, chosen_id: "B", scores: [5,5,4],
tiebreak: "shortest_code", halted: false}`.

---

## Exemplar 3 — spend cap trips mid-search; return best-so-far, halted

**Task**: Generate a numerically-stable `softmax(xs)`. Manifest
`max_candidates = 5`, `spend_cap_usd = 0.50`. Each `sparc:coder` candidate plus
its kernel run is metered at ~$0.13.

**Progress.**

```
branch 1  generate+exec  running cost $0.13  → passed 3/4  (overflows on large inputs)
branch 2  generate+exec  running cost $0.27  → passed 4/4  (max-subtract stabilised)
branch 3  generate+exec  running cost $0.41  → passed 3/4  (no max-subtract; exp overflow)
        pre-branch-4 cost check: 0.41 + ~0.13 = 0.54 > spend_cap_usd 0.50  → HALT
```

**Step 6 — halt and return best-so-far.** Branches 4 and 5 are never generated.
The best candidate observed is branch 2 (4/4), so it is selected and returned
with the halt annotation.

**Step 7 — audit:**
```json
{
  "run": "urn:agentbox:tree-search:<scope>:<run-id>",
  "n_candidates": 3,
  "max_candidates": 5,
  "chosen_id": "2",
  "scores": [3, 4, 3],
  "halted": true,
  "reason": "spend_cap",
  "total_cost_usd": 0.41
}
```

The span records `halted=true`. The caller gets a *correct* result (branch 2
passed every assertion) and an honest signal that the search stopped early — not
an unbounded cost overrun. Had no branch passed all assertions, the caller would
receive the highest partial-pass branch plus the same `halted` annotation, and
should treat the result as unverified.
