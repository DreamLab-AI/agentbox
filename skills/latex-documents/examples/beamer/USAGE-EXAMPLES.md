# Beamer AmurMaple Theme - Usage Examples

Quick copy-paste examples for common presentation patterns.

## Basic Setup

```latex
\documentclass{beamer}
\usetheme[sidebar,rule,amurmapleblue]{Amurmaple}

\title{My Presentation}
\author{Your Name}
\institute{Your Institution}
\mail{your@email.com}

\begin{document}
\frame{\titlepage}

% Your content here

\thanksframe{Thank you!}
\end{document}
```

## Pattern 1: Simple Bullet Points

```latex
\begin{frame}{Key Points}
  \begin{itemize}
    \item First important point
    \item Second important point
    \item Third important point
  \end{itemize}
\end{frame}
```

## Pattern 2: Progressive Reveal

```latex
\begin{frame}{Step by Step}
  \begin{enumerate}
    \item<1-> First step appears
    \item<2-> Second step appears
    \item<3-> Third step appears
    \item<4-> Final step appears
  \end{enumerate}
\end{frame}
```

## Pattern 3: Two-Column Layout

```latex
\begin{frame}{Comparison}
  \begin{columns}[T]
    \begin{column}{0.48\textwidth}
      \framesection{Approach A}
      \begin{itemize}
        \item Advantage 1
        \item Advantage 2
      \end{itemize}
    \end{column}
    \begin{column}{0.48\textwidth}
      \framesection{Approach B}
      \begin{itemize}
        \item Advantage 1
        \item Advantage 2
      \end{itemize}
    \end{column}
  \end{columns}
\end{frame}
```

## Pattern 4: Code Example

```latex
\begin{frame}[fragile]{Python Example}
  \begin{lstlisting}[language=Python]
def calculate_average(numbers):
    """Calculate the average of a list"""
    total = sum(numbers)
    count = len(numbers)
    return total / count

result = calculate_average([10, 20, 30])
print(f"Average: {result}")
  \end{lstlisting}
\end{frame}
```

## Pattern 5: Code + Explanation

```latex
\begin{frame}[fragile]{Algorithm Explanation}
  \begin{columns}[T]
    \begin{column}{0.48\textwidth}
      \framesection{Implementation}
      \begin{lstlisting}[language=Python]
for i in range(n):
    if condition(i):
        process(i)
      \end{lstlisting}
    \end{column}
    \begin{column}{0.48\textwidth}
      \framesection{Explanation}
      \begin{itemize}
        \item Iterate through range
        \item Check condition
        \item Process valid items
      \end{itemize}
    \end{column}
  \end{columns}
\end{frame}
```

## Pattern 6: Mathematical Equation

```latex
\begin{frame}{Important Formula}
  \framesection{The Equation}

  \[
    E = mc^2
  \]

  where:
  \begin{itemize}
    \item $E$ is energy
    \item $m$ is mass
    \item $c$ is speed of light
  \end{itemize}
\end{frame}
```

## Pattern 7: Theorem and Proof

```latex
\begin{frame}{Main Result}
  \begin{theorem}[Fundamental Theorem]
    For all $x \in \mathbb{R}$, we have $x^2 \geq 0$.
  \end{theorem}

  \begin{proof}
    \begin{itemize}
      \item If $x > 0$: $x^2 = x \cdot x > 0$
      \item If $x = 0$: $x^2 = 0$
      \item If $x < 0$: $x^2 = (-x) \cdot (-x) > 0$
    \end{itemize}
  \end{proof}
\end{frame}
```

## Pattern 8: Highlighted Blocks

```latex
\begin{frame}{Results}
  \begin{block}{Key Finding}
    Our method achieves 95\% accuracy.
  \end{block}

  \begin{alertblock}{Important Note}
    Requires GPU for real-time processing.
  \end{alertblock}

  \begin{exampleblock}{Use Case}
    Successfully deployed in production.
  \end{exampleblock}
\end{frame}
```

## Pattern 9: Table with Results

```latex
\begin{frame}{Performance Comparison}
  \begin{table}
    \caption{Benchmark results}
    \begin{tabular}{lcc}
      \toprule
      Method & Accuracy & Speed \\
      \midrule
      Baseline & 85\% & 100ms \\
      Ours & 95\% & 80ms \\
      \bottomrule
    \end{tabular}
  \end{table>
\end{frame}
```

## Pattern 10: Section Separator

```latex
\section{Introduction}
\sepframe

\begin{frame}{First Slide}
  Content after separator...
\end{frame}
```

## Pattern 11: Custom Separator

```latex
\section{Results}
\sepframe[title={Our Main Results}]

\begin{frame}{Experimental Results}
  Content here...
\end{frame}
```

## Pattern 12: Quote

```latex
\begin{frame}{Motivation}
  \begin{quotation}[Albert Einstein]
    Everything should be made as simple as possible,
    but not simpler.
  \end{quotation}

  This guides our approach...
\end{frame>
```

## Pattern 13: Information Box

```latex
\begin{frame}{Setup Requirements}
  \begin{information}[System Requirements]
    \begin{itemize}
      \item Python 3.8+
      \item 8GB RAM minimum
      \item GPU recommended
    \end{itemize}
  \end{information}
\end{frame>
```

## Pattern 14: Inline Alert

```latex
\begin{frame}{Important Points}
  Regular text with \boxalert{critical information}
  that needs emphasis.

  Another sentence with \boxalert{another alert}.
\end{frame>
```

## Pattern 15: Diagram with TikZ

```latex
\begin{frame}{System Architecture}
  \begin{center}
    \begin{tikzpicture}[node distance=2cm]
      \node[rectangle,draw,fill=blue!20] (input) {Input};
      \node[rectangle,draw,fill=green!20,below of=input] (process) {Process};
      \node[rectangle,draw,fill=red!20,below of=process] (output) {Output};

      \draw[->,thick] (input) -- (process);
      \draw[->,thick] (process) -- (output);
    \end{tikzpicture}
  \end{center}
\end{frame>
```

## Complete Example Template

```latex
\documentclass{beamer}
\usetheme[sidebar,rule,amurmapleblue]{Amurmaple}

\usepackage{listings}
\usepackage{booktabs}
\usepackage{tikz}

\lstset{
  basicstyle=\ttfamily\small,
  keywordstyle=\color{blue}\bfseries,
  backgroundcolor=\color{gray!10}
}

\title{Your Presentation Title}
\subtitle{Optional Subtitle}
\author{Your Name}
\institute{Your Institution}
\date{\today}
\mail{your@email.com}

\begin{document}

% Title
\frame{\titlepage}

% TOC
\begin{frame}{Outline}
  \tableofcontents
\end{frame}

% Section 1
\section{Introduction}
\sepframe

\begin{frame}{Background}
  \begin{itemize}
    \item Point 1
    \item Point 2
    \item Point 3
  \end{itemize}
\end{frame}

% Section 2
\section{Methods}
\sepframe

\begin{frame}[fragile]{Implementation}
  \begin{columns}[T]
    \begin{column}{0.48\textwidth}
      \begin{lstlisting}[language=Python]
def method():
    return result
      \end{lstlisting}
    \end{column}
    \begin{column}{0.48\textwidth}
      Explanation here...
    \end{column}
  \end{columns}
\end{frame}

% Section 3
\section{Results}
\sepframe

\begin{frame}{Performance}
  \begin{block}{Key Result}
    95\% accuracy achieved.
  \end{block}
\end{frame}

% Conclusion
\section{Conclusion}
\sepframe

\begin{frame}{Summary}
  \begin{enumerate}
    \item First contribution
    \item Second contribution
    \item Future work
  \end{enumerate}
\end{frame}

% Thank you
\thanksframe{Thank you for your attention!}

\end{document}
```

## Compilation Commands

```bash
# Basic compilation
./compile-beamer.sh presentation.tex

# With bibliography
./compile-beamer.sh presentation.tex --biber

# Generate handout
./compile-beamer.sh presentation.tex --handout

# Clean build
./compile-beamer.sh presentation.tex --clean --biber
```

## Tips

1. **Keep frames simple** - One main idea per slide
2. **Use overlays wisely** - Don't overuse animations
3. **Code = fragile** - Always use `[fragile]` for code frames
4. **Consistent style** - Use same block types throughout
5. **Test early** - Compile frequently to catch errors

## Common Customizations

```latex
% Change color scheme
\usetheme[amurmaplegreen]{Amurmaple}

% Add sidebar
\usetheme[sidebar,amurmapleblue]{Amurmaple}

% Left-aligned titles with rule
\usetheme[leftframetitle,rule]{Amurmaple}

% Combine options
\usetheme[sidebar,rule,leftframetitle,amurmapleblack]{Amurmaple}
```
