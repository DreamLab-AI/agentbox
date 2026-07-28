# Styling & Templates

## Professional Styling

### Dark Theme (report-builder compatible)

```bash
# Create dark theme config
cat > mermaid-dark.json << 'EOF'
{
  "theme": "dark",
  "themeVariables": {
    "primaryColor": "#2471A3",
    "primaryTextColor": "#FFFFFF",
    "primaryBorderColor": "#5DADE2",
    "lineColor": "#ABB2B9",
    "secondaryColor": "#1B4F72",
    "tertiaryColor": "#0B2545",
    "background": "#0B2545",
    "mainBkg": "#13315C",
    "nodeBorder": "#5DADE2",
    "clusterBkg": "#1B4F72",
    "clusterBorder": "#2471A3",
    "titleColor": "#FFFFFF",
    "edgeLabelBackground": "#13315C",
    "fontSize": "14px"
  }
}
EOF

# Render with dark theme
mmdc-sidecar.sh -i diagram.mmd -o diagram.png -t dark
```

### Light Theme (academic papers)

```bash
cat > mermaid-light.json << 'EOF'
{
  "theme": "default",
  "themeVariables": {
    "primaryColor": "#D6EAF8",
    "primaryTextColor": "#0B2545",
    "primaryBorderColor": "#1B4F72",
    "lineColor": "#566573",
    "secondaryColor": "#FADBD8",
    "tertiaryColor": "#D5F5E3",
    "fontSize": "13px",
    "fontFamily": "serif"
  }
}
EOF

mmdc-sidecar.sh -i diagram.mmd -o diagram.png
```

Ready-made theme configs also live in `resources/templates/theme-dark.json` and
`resources/templates/theme-light.json`.

### Per-node styling (inline)

```mermaid
flowchart TD
    A[Leakage Crisis]:::crisis --> B[Infrastructure Decay]:::infra
    B --> C[Regulatory Response]:::regulation

    classDef crisis fill:#E74C3C,stroke:#C0392B,color:#FFF
    classDef infra fill:#566573,stroke:#2C3E50,color:#FFF
    classDef regulation fill:#8E44AD,stroke:#6C3483,color:#FFF
```

---

## Templates by Use Case

### System Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend Layer"]
        UI[Web App] --> API[API Gateway]
    end
    subgraph Backend["Backend Services"]
        API --> Auth[Auth Service]
        API --> Data[Data Service]
        API --> Queue[Message Queue]
    end
    subgraph Storage["Data Layer"]
        Data --> DB[(PostgreSQL)]
        Data --> Cache[(Redis)]
        Queue --> Worker[Worker Pool]
    end

    style Frontend fill:#D6EAF8,stroke:#1B4F72
    style Backend fill:#D5F5E3,stroke:#1E8449
    style Storage fill:#FCF3CF,stroke:#D4AC0D
```

### API Sequence

```mermaid
sequenceDiagram
    actor User
    participant App as Web App
    participant API as API Server
    participant DB as Database
    participant Cache as Redis Cache

    User->>App: Submit Request
    App->>API: POST /api/data
    API->>Cache: Check cache
    alt Cache hit
        Cache-->>API: Cached data
    else Cache miss
        API->>DB: Query
        DB-->>API: Results
        API->>Cache: Store in cache
    end
    API-->>App: JSON Response
    App-->>User: Display Results
```

### Database ER Diagram

```mermaid
erDiagram
    WATER_COMPANY ||--o{ TREATMENT_WORKS : operates
    WATER_COMPANY ||--o{ PIPE_NETWORK : owns
    WATER_COMPANY {
        string company_id PK
        string name
        float leakage_mld
        float gearing_pct
        string ea_rating
    }
    PIPE_NETWORK ||--o{ DMA : contains
    PIPE_NETWORK {
        string network_id PK
        float length_km
        int age_years
        string material
    }
    DMA ||--o{ SENSOR : monitors
    DMA {
        string dma_id PK
        float flow_mld
        float night_flow
        int burst_count
    }
```

### Project Gantt

```mermaid
gantt
    title UK Water Sector Investment Roadmap
    dateFormat YYYY
    axisFormat %Y

    section AMP8 (2025-2030)
        Smart metering rollout    :2025, 2030
        CSO upgrades (2,500)      :2025, 2030
        New super-regulator       :2026, 2028
        Thames Tideway opens      :milestone, 2025, 0d

    section AMP9 (2030-2035)
        RAPID schemes deliver     :2030, 2035
        Bathing water CSO target  :milestone, 2035, 0d

    section AMP10 (2035-2040)
        SESRO reservoir           :2035, 2040
        Ecological CSO targets    :milestone, 2040, 0d

    section AMP11-12 (2040-2050)
        50% leakage reduction     :2040, 2050
        PCC 110 l/p/d target      :milestone, 2050, 0d
```

### Wardley-style Mindmap

```mermaid
mindmap
  root((UK Water Sector))
    Leakage
      2,869 Ml/d E&W
      Acoustic detection
      AI/ML prediction
      Smart metering
    Sewage
      3.6M spill hours
      CSO infrastructure
      Nature-based solutions
      Thames Tideway
    Infrastructure
      £104bn PR24
      0.14% renewal rate
      Lead pipes
      Digital twins
    Climate
      4.9 Gl/d deficit 2055
      2025 drought record
      RAPID schemes
      Demand management
    Regulation
      Ofwat abolished
      Super-regulator
      88 Cunliffe recommendations
      Water Reform Bill 2026
```

### C4 Context Diagram

```mermaid
C4Context
    title UK Water Sector — System Context

    Person(customer, "Customer", "16M households in E&W")
    Person(regulator, "Regulator", "Ofwat / EA / DWI")

    System(waterco, "Water Company", "Treats and distributes water, manages sewerage")
    System_Ext(environment, "Natural Environment", "Rivers, aquifers, rainfall")
    System_Ext(climate, "Climate System", "Temperature, rainfall patterns")

    Rel(customer, waterco, "Pays bills, reports leaks")
    Rel(waterco, customer, "Delivers water, removes sewage")
    Rel(regulator, waterco, "Sets targets, enforces compliance")
    Rel(environment, waterco, "Provides raw water")
    Rel(waterco, environment, "Discharges treated effluent, CSO spills")
    Rel(climate, environment, "Modifies availability")
```

---

## Best Practices

1. **Use meaningful IDs**: `userAuth` not `A`, `paymentGateway` not `B`
2. **Keep it simple**: Under 30-40 nodes per diagram; split complex ones
3. **Consistent direction**: `TD` for hierarchies, `LR` for processes, `BT` for bottom-up
4. **Colour with purpose**: Use `classDef` for semantic meaning (red=error, green=success)
5. **Version control**: `.mmd` files are plain text — diff-friendly in git
6. **Theme consistency**: Use the same config across all diagrams in a project
7. **Label edges**: Always label arrows to show relationships: `A -->|"sends data"| B`
8. **Subgraphs for grouping**: Use subgraphs to create logical sections
</content>
