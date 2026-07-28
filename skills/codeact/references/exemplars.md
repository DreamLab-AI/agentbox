# CodeAct — In-Context Learning Exemplars

The three exemplars below show the exact tool call syntax the model emits.
Each exemplar references variables from the prior call to demonstrate
`KernelSession` state persistence.

---

## Exemplar 1 -- Numerical Reasoning with Intermediate DataFrame

**Task**: Given a CSV at `/tmp/sales.csv`, find rows where `revenue` exceeds
the mean of `cost`, sorted by `margin` descending, top 5.

**Call 1 -- load and inspect**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "import pandas as pd\ndf = pd.read_csv('/tmp/sales.csv')\nprint(df.shape)\nprint(df.dtypes)"
}
Trace: {
  "stdout": "(4821, 6)\nregion       object\nproduct      object\nrevenue     float64\ncost        float64\nmargin      float64\nquarter      object\ndtype: object\n",
  "result": null,
  "exception": null,
  "duration_ms": 231
}
```

State after call 1: `df` is live in the `KernelSession`. No re-read needed.

**Call 2 -- filter using `df` from call 1**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "cost_mean = df['cost'].mean()\nfiltered = df[df['revenue'] > cost_mean].copy()\nprint(f'cost_mean={cost_mean:.2f}, rows matching={len(filtered)}')"
}
Trace: {
  "stdout": "cost_mean=18432.71, rows matching=2194\n",
  "result": null,
  "exception": null,
  "duration_ms": 18
}
```

State after call 2: `filtered` and `cost_mean` persist. The filter was
derived from the loaded data without reloading.

**Call 3 -- sort and head using `filtered` from call 2**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "top5 = filtered.sort_values('margin', ascending=False).head(5)\nprint(top5[['product', 'revenue', 'cost', 'margin']].to_string(index=False))"
}
Trace: {
  "stdout": "     product   revenue     cost   margin\n  Widget-Pro  98432.00  12100.00  86332.0\n  Widget-Pro  94100.50  11900.00  82200.5\n  Service-A   88250.00  10200.00  78050.0\n  Widget-X    75300.00   9800.00  65500.0\n  Service-B   70100.00   9200.00  60900.0\n",
  "result": null,
  "exception": null,
  "duration_ms": 9
}
```

The result is the top-5 rows. Task complete. Variables `df`, `filtered`,
`cost_mean`, and `top5` remain available for follow-up queries without
reloading the CSV.

---

## Exemplar 2 -- Iterative Regex / Parsing on Real Text

**Task**: Extract every ISO-8601 date from `/var/log/app.log` and produce a
histogram by month.

**Call 1 -- extract dates**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "import re\nfrom collections import Counter\n\nwith open('/var/log/app.log') as fh:\n    text = fh.read()\n\npattern = r'\\b(\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))\\b'\ndates = re.findall(pattern, text)\nprint(f'found {len(dates)} date occurrences')\nprint('sample:', dates[:5])"
}
Trace: {
  "stdout": "found 1847 date occurrences\nsample: ['2026-01-03', '2026-01-03', '2026-01-07', '2026-02-11', '2026-02-11']\n",
  "result": null,
  "exception": null,
  "duration_ms": 84
}
```

State after call 1: `dates` list is live. No re-read of the log file needed.

**Call 2 -- histogram by month using `dates` from call 1**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "months = Counter(d[:7] for d in dates)\nfor month, count in sorted(months.items()):\n    bar = '#' * (count // 10)\n    print(f'{month}  {count:4d}  {bar}')"
}
Trace: {
  "stdout": "2026-01   412  ########################################\n2026-02   389  ######################################\n2026-03   401  ########################################\n2026-04   317  ###############################\n2026-05   328  ################################\n",
  "result": null,
  "exception": null,
  "duration_ms": 4
}
```

The histogram is complete in two `exec` calls. The `dates` list produced in
call 1 was reused directly; the file was read exactly once.

---

## Exemplar 3 -- Hypothesis-Test Loop with Explicit Assertion and Revision

**Task**: Compute 17^23 mod 100.

**Call 1 -- first attempt (simulating a naive mistake)**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "result = 17 ** 23 % 100\nprint(result)"
}
Trace: {
  "stdout": "57\n",
  "result": null,
  "exception": null,
  "duration_ms": 2
}
```

The model observes `stdout: "57\n"`. Suppose the model had expected a
different answer from mental arithmetic. It adds an assertion to validate
using a cross-check:

**Call 2 -- assertion and independent verification**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "# Cross-check via pow() three-argument form (modular exponentiation)\ncross = pow(17, 23, 100)\nprint(f'pow() result: {cross}')\nassert result == cross, f'mismatch: {result} vs {cross}'\nprint('assertion passed')"
}
Trace: {
  "stdout": "pow() result: 57\nassertion passed\n",
  "result": null,
  "exception": null,
  "duration_ms": 2
}
```

Both methods agree: 17^23 mod 100 = 57. The `ExecutionTrace` carries
`exception: null` and the assertion-pass string in `stdout` -- this is
Trace-as-Reward in action. No LLM judge; the kernel is the verifier.

The variable `result` and `cross` remain in the `KernelSession` and can be
used in subsequent reasoning steps without recomputation.
