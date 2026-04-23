# Beamer Presentation Examples with AmurMaple Theme

Professional presentation templates and examples using the AmurMaple Beamer theme.

## Quick Start

```bash
# Compile the demo presentation
./compile-beamer.sh demo-presentation.tex

# Compile with bibliography support
./compile-beamer.sh demo-presentation.tex --biber

# Generate handout version
./compile-beamer.sh demo-presentation.tex --handout
```

## Available Files

### Templates (in `../../templates/beamer/`)

1. **amurmaple-basic.tex**
   - Simple presentation structure
   - Perfect for quick presentations
   - Basic sections and slides
   - Standard blocks and lists

2. **amurmaple-academic.tex**
   - Research presentation template
   - Bibliography support with BibTeX/Biber
   - Mathematical equations and theorems
   - Multi-column layouts
   - Abstract and quotation environments

3. **amurmaple-technical.tex**
   - Technical/engineering presentations
   - Code listings with syntax highlighting
   - TikZ diagrams and flowcharts
   - Docker and system architecture examples
   - Performance metrics tables

### Examples (current directory)

1. **demo-presentation.tex**
   - Comprehensive feature showcase
   - Demonstrates all AmurMaple capabilities
   - Color variants and theme options
   - Block types and environments
   - Overlays and animations
   - Code listings and mathematics

2. **references.bib**
   - Sample bibliography file
   - Example citations for academic presentations

3. **compile-beamer.sh**
   - Automated compilation script
   - Multiple compilation options
   - Support for different LaTeX engines

## AmurMaple Theme Features

### Color Variants

- **Red** (default): Professional and bold
- **Blue**: Cool and academic
- **Green**: Natural and technical
- **Black**: Minimalist and modern

### Layout Options

- **Sidebar navigation**: Section overview
- **Progress gauge**: Visual progress indicator
- **Custom frame titles**: Left or right aligned
- **Decorative rules**: Optional styling
- **Delaunay backgrounds**: Geometric patterns (LuaLaTeX)

### Special Commands

- `\sepframe` - Automatic section separator with TOC
- `\framesection{}` - Subsections within frames
- `\thanksframe{}` - Custom thank you slide
- `\boxalert{}` - Inline alert highlighting
- `\mail{}` - Email metadata
- `\webpage{}` - Website metadata
- `\collaboration{}` - Collaboration information

### Block Types

**Standard:**
- `block` - General content
- `alertblock` - Warnings and alerts
- `exampleblock` - Examples and case studies

**Mathematical:**
- `theorem` - Theorem statements
- `definition` - Definitions
- `corollary` - Corollaries
- `proof` - Proofs

**Custom:**
- `information` - Information boxes with icons
- `remark` - Technical remarks
- `abstract` - Presentation abstracts
- `quotation` - Quotes with attribution

## Compilation Script Usage

### Basic Compilation

```bash
./compile-beamer.sh presentation.tex
```

### Options

- `--clean` - Clean auxiliary files before compilation
- `--handout` - Generate handout version (no overlays)
- `--notes` - Include speaker notes
- `--biber` - Run biber for bibliography
- `--xelatex` - Use XeLaTeX engine
- `--lualatex` - Use LuaLaTeX engine (required for Delaunay)

### Examples

```bash
# Clean build with bibliography
./compile-beamer.sh presentation.tex --clean --biber

# LuaLaTeX compilation for Delaunay backgrounds
./compile-beamer.sh presentation.tex --lualatex

# Generate handout with notes
./compile-beamer.sh presentation.tex --handout --notes
```

## Creating Your Own Presentation

1. **Choose a template** from `../../templates/beamer/`

2. **Copy to your project:**
   ```bash
   cp ../../templates/beamer/amurmaple-basic.tex my-presentation.tex
   ```

3. **Customize metadata:**
   ```latex
   \title{Your Presentation Title}
   \author{Your Name}
   \institute{Your Institution}
   \mail{your.email@example.com}
   ```

4. **Select color variant:**
   ```latex
   \usetheme[amurmapleblue]{Amurmaple}  % or green, black
   ```

5. **Add layout options:**
   ```latex
   \usetheme[sidebar,rule,leftframetitle,amurmapleblue]{Amurmaple}
   ```

6. **Structure content:**
   ```latex
   \section{Introduction}
   \sepframe  % Automatic separator

   \begin{frame}{First Slide}
     Content here
   \end{frame}
   ```

7. **Compile:**
   ```bash
   ./compile-beamer.sh my-presentation.tex
   ```

## Theme Options Reference

```latex
% Color variants
amurmapleblue      % Blue color scheme
amurmaplegreen     % Green color scheme
amurmapleblack     % Black/gray color scheme

% Layout options
sidebar            % Add sidebar navigation
sidebarwidth=<dim> % Set sidebar width (default: 58pt)
leftframetitle     % Left-align frame titles
toplogo            % Place logo at top of sidebar

% Visual options
rule               % Add decorative rule
rulecolor=<color>  % Set rule color
nogauge            % Disable progress gauge
nomail             % Disable email display

% Advanced options (LuaLaTeX only)
delaunay           % Delaunay triangulation background
```

## Bibliography Setup

1. **Create references.bib:**
   ```bibtex
   @article{author2024,
     author = {Author Name},
     title = {Paper Title},
     journal = {Journal Name},
     year = {2024}
   }
   ```

2. **In presentation preamble:**
   ```latex
   \usepackage[backend=biber,style=ieee]{biblatex}
   \addbibresource{references.bib}
   ```

3. **Cite in frames:**
   ```latex
   \begin{frame}{Literature Review}
     Recent work \cite{author2024} shows...
   \end{frame}
   ```

4. **Add bibliography frame:**
   ```latex
   \begin{frame}[allowframebreaks]{References}
     \printbibliography[heading=none]
   \end{frame}
   ```

5. **Compile with biber:**
   ```bash
   ./compile-beamer.sh presentation.tex --biber
   ```

## Code Listings

1. **Setup in preamble:**
   ```latex
   \usepackage{listings}
   \usepackage{xcolor}

   \lstset{
     basicstyle=\ttfamily\small,
     keywordstyle=\color{blue}\bfseries,
     commentstyle=\color{gray}\itshape,
     backgroundcolor=\color{gray!10}
   }
   ```

2. **Use in fragile frames:**
   ```latex
   \begin{frame}[fragile]{Code Example}
     \begin{lstlisting}[language=Python]
     def hello():
         print("Hello, World!")
     \end{lstlisting}
   \end{frame}
   ```

## Overlays and Animations

```latex
% Progressive reveals
\begin{itemize}
  \item<1-> First point
  \item<2-> Second point
  \item<3-> Third point
\end{itemize}

% Highlighting
\begin{itemize}
  \item<1-| alert@1> Highlighted on slide 1
  \item<2-| alert@2> Highlighted on slide 2
\end{itemize}

% Pausing
\begin{itemize}
  \item First
  \pause
  \item Second
  \pause
  \item Third
\end{itemize}
```

## Common Issues

### Theme Not Found

Ensure TEXINPUTS includes the theme directory:
```bash
export TEXINPUTS=../../themes/amurmaple:$TEXINPUTS
pdflatex presentation.tex
```

Or use the compilation script which handles this automatically:
```bash
./compile-beamer.sh presentation.tex
```

### Fragile Frame Errors

Always use `[fragile]` option for frames containing code:
```latex
\begin{frame}[fragile]{Code}
  \begin{lstlisting}
  ...
  \end{lstlisting}
\end{frame}
```

### Bibliography Not Showing

1. Run compilation multiple times:
   ```bash
   pdflatex presentation.tex
   biber presentation
   pdflatex presentation.tex
   pdflatex presentation.tex
   ```

2. Or use the script:
   ```bash
   ./compile-beamer.sh presentation.tex --biber
   ```

### Delaunay Background Not Working

Delaunay option requires LuaLaTeX:
```bash
./compile-beamer.sh presentation.tex --lualatex
```

## Resources

- **Beamer Documentation**: `texdoc beamer`
- **AmurMaple Theme**: `themes/amurmaple/beamerthemeAmurmaple.sty`
- **Overleaf Beamer Guide**: https://www.overleaf.com/learn/latex/Beamer
- **LaTeX Skill Documentation**: `../../SKILL.md`

## License

AmurMaple theme is licensed under LPPL 1.3 (LaTeX Project Public License).
Examples and templates are provided for educational and professional use.
