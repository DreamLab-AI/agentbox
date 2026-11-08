# StatCraft SPSS Syntax & Procedure Reference Manual

================================================================================
  StatCraft Autonomous Code Mode - SPSS Syntax Quick Reference
================================================================================

Commands are executed sequentially in batch mode. Each command must end with a period (.).

1. DESCRIPTIVE STATISTICS:
   * DESCRIPTIVES VARIABLES=vars [/STATISTICS=MEAN STDDEV MIN MAX SEMEAN].
   * FREQUENCIES VARIABLES=vars [/STATISTICS=MEAN MEDIAN MODE STDDEV].
   * CROSSTABS /TABLES=row_vars BY col_vars [/STATISTICS=CHISQ PHI CC].

2. COMPARE MEANS:
   * MEANS TABLES=dep_vars BY factor_vars [/STATISTICS=ANOVA].
   * T-TEST GROUPS=var(v1 v2) /VARIABLES=vars [/CRITERIA=CI(0.95)].
   * T-TEST PAIRS=v1 WITH v2 (PAIRED).
   * T-TEST /TESTVAL=value /VARIABLES=vars.
   * ONEWAY dep_vars BY factor_var [/STATISTICS DESCRIPTIVES HOMOGENEITY].

3. CORRELATION & REGRESSION:
   * CORRELATIONS /VARIABLES=vars [/PRINT=TWOTAIL] [/STATISTICS=DESCRIPTIVES].
   * REGRESSION /DEPENDENT=var /METHOD=ENTER indep_vars.

4. SCALE & FACTOR ANALYSIS:
   * RELIABILITY /VARIABLES=vars [/MODEL=ALPHA].
   * FACTOR /VARIABLES=vars [/EXTRACTION=PC].

5. DATA TRANSFORMATIONS & FILTERING:
   * COMPUTE target = expression.
   * SORT CASES BY var1 (A) var2 (D).
   * SPLIT FILE BY varlist. | SPLIT FILE OFF.
   * WEIGHT BY weight_var. | WEIGHT OFF.
   * FILTER BY filter_var. | FILTER OFF.

6. VARIABLE DICTIONARY & METADATA:
   * VARIABLE LEVEL varlist (SCALE | ORDINAL | NOMINAL).
   * VARIABLE LABELS var 'Label' [var2 'Label 2'].
   * VALUE LABELS var 1 'Label 1' 2 'Label 2'.
   * MISSING VALUES var (val1, val2) | (low THRU high).

To see detailed syntax and options for a specific command, run:
  HELP <COMMAND>.   (e.g., HELP ONEWAY. or HELP T-TEST.)
Dynamic MCP resource: statcraft://syntax-reference

---

## Detailed Command Specifications

### DESCRIPTIVES
```sps
PROCEDURE: DESCRIPTIVES
Computes univariate summary statistics for scale variables.

SYNTAX:
  DESCRIPTIVES VARIABLES=varlist
    [/STATISTICS=[MEAN] [STDDEV] [MIN] [MAX] [SEMEAN] [VARIANCE]].

EXAMPLE:
  DESCRIPTIVES VARIABLES=salary age
    /STATISTICS=MEAN STDDEV MIN MAX SEMEAN.
```

### FREQUENCIES
```sps
PROCEDURE: FREQUENCIES
Produces frequency counts, percentages, and percentiles.

SYNTAX:
  FREQUENCIES VARIABLES=varlist
    [/STATISTICS=[MEAN] [MEDIAN] [MODE] [STDDEV]]
    [/FORMAT=[AVALUE | DVALUE]].

EXAMPLE:
  FREQUENCIES VARIABLES=jobcat gender
    /STATISTICS=MEAN MEDIAN.
```

### CROSSTABS
```sps
PROCEDURE: CROSSTABS
Generates two-way contingency tables and association statistics.

SYNTAX:
  CROSSTABS /TABLES=row_vars BY col_vars
    [/STATISTICS=[CHISQ] [PHI] [CC]].

EXAMPLE:
  CROSSTABS /TABLES=jobcat BY gender
    /STATISTICS=CHISQ PHI.
```

### MEANS
```sps
PROCEDURE: MEANS
Calculates subgroup means and one-way ANOVA table across categories.

SYNTAX:
  MEANS TABLES=dep_vars BY factor_vars
    [/STATISTICS=[ANOVA]].

EXAMPLE:
  MEANS TABLES=salary BY jobcat
    /STATISTICS=ANOVA.
```

### T-TEST
```sps
PROCEDURE: T-TEST
Performs Student's t-tests (Independent samples, Paired, or One-sample).

SYNTAX:
  1. Independent Samples:
     T-TEST GROUPS=group_var(val1 val2) /VARIABLES=varlist [/CRITERIA=CI(level)].
  2. Paired Samples:
     T-TEST PAIRS=var1 WITH var2 (PAIRED) [/CRITERIA=CI(level)].
  3. One-Sample:
     T-TEST /TESTVAL=value /VARIABLES=varlist [/CRITERIA=CI(level)].

EXAMPLES:
  T-TEST GROUPS=gender(1 2) /VARIABLES=salary /CRITERIA=CI(0.95).
  T-TEST PAIRS=before WITH after (PAIRED).
  T-TEST /TESTVAL=50000 /VARIABLES=salary.
```

### ONEWAY
```sps
PROCEDURE: ONEWAY
Conducts One-Way Analysis of Variance with Levene's test and descriptives.

SYNTAX:
  ONEWAY dep_vars BY factor_var
    [/STATISTICS=[DESCRIPTIVES] [HOMOGENEITY]]
    [/CRITERIA=CI(level)].

EXAMPLE:
  ONEWAY salary BY jobcat
    /STATISTICS DESCRIPTIVES HOMOGENEITY
    /CRITERIA=CI(0.95).
```

### CORRELATIONS
```sps
PROCEDURE: CORRELATIONS
Computes Pearson, Spearman, and Kendall bivariate correlation coefficients.

SYNTAX:
  CORRELATIONS /VARIABLES=varlist
    [/PRINT=[TWOTAIL | ONETAIL] [NOSIG]]
    [/STATISTICS=[DESCRIPTIVES] [XPROD]].

EXAMPLE:
  CORRELATIONS /VARIABLES=salary educ prevexp
    /PRINT=TWOTAIL
    /STATISTICS=DESCRIPTIVES.
```

### REGRESSION
```sps
PROCEDURE: REGRESSION
Fits linear regression models with ANOVA, coefficients, and collinearity diagnostics.

SYNTAX:
  REGRESSION
    /DEPENDENT=dep_var
    /METHOD=ENTER indep_vars.

EXAMPLE:
  REGRESSION
    /DEPENDENT=salary
    /METHOD=ENTER educ prevexp jobtime.
```

### RELIABILITY
```sps
PROCEDURE: RELIABILITY
Computes Cronbach's Alpha and item-total reliability statistics.

SYNTAX:
  RELIABILITY /VARIABLES=varlist
    [/MODEL=ALPHA]
    [/SUMMARY=TOTAL].

EXAMPLE:
  RELIABILITY /VARIABLES=item1 item2 item3 item4
    /MODEL=ALPHA.
```

### FACTOR
```sps
PROCEDURE: FACTOR
Performs Principal Component Factor Analysis with KMO and Bartlett tests.

SYNTAX:
  FACTOR /VARIABLES=varlist
    [/EXTRACTION=PC]
    [/CRITERIA=FACTORS(k) | MINEIGEN(val)]
    [/ROTATION=VARIMAX].

EXAMPLE:
  FACTOR /VARIABLES=q1 q2 q3 q4 q5
    /EXTRACTION=PC.
```

### VARIABLE LEVEL
```sps
COMMAND: VARIABLE LEVEL
Assigns measurement levels (SCALE, ORDINAL, NOMINAL) to variables.

SYNTAX:
  VARIABLE LEVEL varlist (SCALE | ORDINAL | NOMINAL) [/varlist2 (...)].

EXAMPLE:
  VARIABLE LEVEL salary age (SCALE) /gender (NOMINAL).
```

### VARIABLE LABELS
```sps
COMMAND: VARIABLE LABELS
Assigns descriptive labels to variables.

SYNTAX:
  VARIABLE LABELS var 'Label string' [var2 'Label 2'].

EXAMPLE:
  VARIABLE LABELS salary 'Annual Salary in USD' age 'Age in Years'.
```

### VALUE LABELS
```sps
COMMAND: VALUE LABELS
Assigns descriptive labels to categorical values.

SYNTAX:
  VALUE LABELS var val1 'Label 1' val2 'Label 2' [/var2 ...].

EXAMPLE:
  VALUE LABELS gender 1 'Male' 2 'Female'.
```

### MISSING VALUES
```sps
COMMAND: MISSING VALUES
Specifies user-missing discrete values or numeric ranges.

SYNTAX:
  MISSING VALUES var (val1, val2, val3) | (low THRU high).

EXAMPLE:
  MISSING VALUES salary (99, 999).
  MISSING VALUES age (0 THRU 17).
```

### COMPUTE
```sps
COMMAND: COMPUTE
Creates or updates a variable from an arithmetic expression.

SYNTAX:
  COMPUTE target_var = expression.

EXAMPLE:
  COMPUTE log_salary = LN(salary).
  COMPUTE total_score = q1 + q2 + q3.
```

### SORT CASES
```sps
COMMAND: SORT CASES
Sorts active dataset rows by one or more variables.

SYNTAX:
  SORT CASES BY var1 [(A|D)] [var2 ...].

EXAMPLE:
  SORT CASES BY department (A) salary (D).
```

### SPLIT FILE
```sps
COMMAND: SPLIT FILE
Divides dataset into subgroups for comparative analysis.

SYNTAX:
  SPLIT FILE BY varlist.
  SPLIT FILE OFF.

EXAMPLE:
  SPLIT FILE BY gender.
```

### WEIGHT
```sps
COMMAND: WEIGHT
Applies case weights to subsequent statistical procedures.

SYNTAX:
  WEIGHT BY weight_var.
  WEIGHT OFF.
```

### FILTER
```sps
COMMAND: FILTER
Filters cases based on a binary or indicator variable.

SYNTAX:
  FILTER BY filter_var.
  FILTER OFF.
```


