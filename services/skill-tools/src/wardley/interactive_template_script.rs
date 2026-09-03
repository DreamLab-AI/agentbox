//! `HTML_TAIL` for [`super::interactive`] — the D3.js force-simulation script and
//! closing HTML, split out of `interactive_template.rs` to keep both files under the
//! 500-line guideline. See that module's docs for the head/tail split point and the
//! double-brace JSON bug fixed at the seam between them.

pub const HTML_TAIL: &str = r#";

        const width = document.getElementById('canvas').clientWidth;
        const height = document.getElementById('canvas').clientHeight;
        const margin = { top: 80, right: 100, bottom: 100, left: 100 };
        const mapWidth = width - margin.left - margin.right;
        const mapHeight = height - margin.top - margin.bottom;

        // SVG setup
        const svg = d3.select('svg')
            .attr('width', width)
            .attr('height', height);

        // Create main group with margins
        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Add background stages
        const stages = [
            { name: 'Genesis', x: 0, width: 0.15, color: '#f0f0f0' },
            { name: 'Custom', x: 0.15, width: 0.2, color: '#e8e8e8' },
            { name: 'Product', x: 0.35, width: 0.3, color: '#e0e0e0' },
            { name: 'Commodity', x: 0.65, width: 0.35, color: '#d8d8d8' }
        ];

        stages.forEach(stage => {
            g.append('rect')
                .attr('class', 'evolution-stage')
                .attr('x', stage.x * mapWidth)
                .attr('y', 0)
                .attr('width', stage.width * mapWidth)
                .attr('height', mapHeight)
                .attr('fill', stage.color);

            g.append('text')
                .attr('class', 'stage-label')
                .attr('x', (stage.x + stage.width / 2) * mapWidth)
                .attr('y', mapHeight + 30)
                .attr('font-weight', 'bold')
                .text(stage.name);
        });

        // Add axes
        g.append('line')
            .attr('class', 'axis-line')
            .attr('x1', 0)
            .attr('x2', mapWidth)
            .attr('y1', mapHeight)
            .attr('y2', mapHeight);

        g.append('line')
            .attr('class', 'axis-line')
            .attr('x1', 0)
            .attr('x2', 0)
            .attr('y1', 0)
            .attr('y2', mapHeight);

        g.append('text')
            .attr('class', 'axis-label')
            .attr('x', mapWidth / 2)
            .attr('y', mapHeight + 50)
            .attr('text-anchor', 'middle')
            .text('Evolution →');

        g.append('text')
            .attr('class', 'axis-label')
            .attr('x', -mapHeight / 2)
            .attr('y', -50)
            .attr('text-anchor', 'middle')
            .attr('transform', 'rotate(-90)')
            .text('Visibility →');

        // Arrow marker
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('markerWidth', 10)
            .attr('markerHeight', 10)
            .attr('refX', 8)
            .attr('refY', 3)
            .attr('orient', 'auto')
            .append('polygon')
            .attr('points', '0 0, 10 3, 0 6')
            .attr('fill', '#999');

        // Create simulation
        const simulation = d3.forceSimulation(data.nodes)
            .force('link', d3.forceLink(data.links)
                .id(d => d.id)
                .distance(100)
                .strength(0.3))
            .force('x', d3.forceX(d => d.evolution * mapWidth).strength(0.5))
            .force('y', d3.forceY(d => (1 - d.visibility) * mapHeight).strength(0.5))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('collision', d3.forceCollide().radius(25));

        // Create links
        const link = g.append('g')
            .selectAll('line')
            .data(data.links)
            .join('line')
            .attr('class', 'link');

        // Create nodes
        const node = g.append('g')
            .selectAll('g.component')
            .data(data.nodes)
            .join('g')
            .attr('class', d => 'component ' +
                (d.is_strength ? 'strength' :
                 d.is_vulnerability ? 'vulnerability' :
                 d.is_opportunity ? 'opportunity' :
                 d.is_threat ? 'threat' : 'default'));

        node.append('circle')
            .attr('class', 'component-circle')
            .attr('r', 15);

        node.append('text')
            .attr('class', 'component-label')
            .attr('dy', '0.3em')
            .text(d => d.name.substring(0, 10));

        // Zoom behavior
        const zoom = d3.zoom()
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });

        svg.call(zoom);

        document.getElementById('resetZoom').addEventListener('click', () => {
            svg.transition().duration(750).call(
                zoom.transform,
                d3.zoomIdentity
                    .translate(margin.left, margin.top)
            );
        });

        // Drag behavior
        node.call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        // Update positions
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        // Tooltip
        const tooltip = document.querySelector('.tooltip');

        node.on('mouseover', (event, d) => {
            tooltip.classList.add('show');
            tooltip.innerHTML = `
                <div class="tooltip-title">${d.name}</div>
                <div class="tooltip-item"><strong>Stage:</strong> ${d.evolution_stage}</div>
                <div class="tooltip-item"><strong>Visibility:</strong> ${d.visibility_level}</div>
                <div class="tooltip-item"><strong>Category:</strong> ${d.category}</div>
                ${d.description ? `<div class="tooltip-item">${d.description}</div>` : ''}
            `;
            const rect = event.target.getBoundingClientRect();
            tooltip.style.left = (rect.left + 20) + 'px';
            tooltip.style.top = (rect.top - 20) + 'px';
        })
        .on('mousemove', (event) => {
            tooltip.style.left = (event.clientX + 20) + 'px';
            tooltip.style.top = (event.clientY - 20) + 'px';
        })
        .on('mouseout', () => {
            tooltip.classList.remove('show');
        })
        .on('click', (event, d) => {
            const panel = document.getElementById('infoPanel');
            panel.style.display = 'block';
            panel.innerHTML = `
                <strong>${d.name}</strong><br>
                Stage: ${d.evolution_stage}<br>
                Visibility: ${d.visibility_level}<br>
                <br>
                <small>${d.description || 'No description'}</small>
            `;
        });

        // Filters
        document.getElementById('stageFilter').addEventListener('change', (e) => {
            const stage = e.target.value;
            node.style('opacity', d => !stage || d.evolution_stage === stage ? 1 : 0.2);
        });

        document.getElementById('insightFilter').addEventListener('change', (e) => {
            const insight = e.target.value;
            node.style('opacity', d => {
                if (!insight) return 1;
                if (insight === 'strength') return d.is_strength ? 1 : 0.2;
                if (insight === 'vulnerability') return d.is_vulnerability ? 1 : 0.2;
                if (insight === 'opportunity') return d.is_opportunity ? 1 : 0.2;
                if (insight === 'threat') return d.is_threat ? 1 : 0.2;
                return 1;
            });
        });

        document.getElementById('toggleGrid').addEventListener('click', () => {
            g.selectAll('.evolution-stage').style('opacity',
                (_, i, nodes) => nodes[0].style.opacity === '0.05' ? 0 : 0.05
            );
        });
    </script>
</body>
</html>"#;
