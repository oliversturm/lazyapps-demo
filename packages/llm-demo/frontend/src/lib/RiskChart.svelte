<script>
  import { line, curveMonotoneX } from 'd3-shape';
  import { scaleLinear, scaleTime } from 'd3-scale';
  import { extent } from 'd3-array';

  export let data = [];
  export let customerName = '';
  export let width = 300;
  export let height = 120;

  const margin = { top: 8, right: 36, bottom: 22, left: 28 };

  // Zone thresholds
  const zones = [
    { y0: 0, y1: 33, color: 'rgba(34, 197, 94, 0.08)', label: 'low' },
    { y0: 34, y1: 66, color: 'rgba(234, 179, 8, 0.08)', label: 'medium' },
    { y0: 67, y1: 100, color: 'rgba(239, 68, 68, 0.08)', label: 'high' },
  ];

  const yTicks = [0, 34, 67, 100];

  const pointColor = (score) =>
    score >= 67
      ? '#ef4444'
      : score >= 34
        ? '#eab308'
        : '#22c55e';

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Filter valid data points
  $: validData = (data || []).filter(
    (d) => d.riskScore != null && d.timestamp,
  );

  $: plotWidth = width - margin.left - margin.right;
  $: plotHeight = height - margin.top - margin.bottom;

  $: yScale = scaleLinear().domain([0, 100]).range([plotHeight, 0]);

  $: xScale = (() => {
    if (validData.length < 2) {
      return scaleTime()
        .domain([new Date(), new Date()])
        .range([0, plotWidth]);
    }
    const [min, max] = extent(validData, (d) => new Date(d.timestamp));
    return scaleTime().domain([min, max]).range([0, plotWidth]);
  })();

  $: pathGenerator = line()
    .x((d) => xScale(new Date(d.timestamp)))
    .y((d) => yScale(d.riskScore))
    .curve(curveMonotoneX);

  $: pathD = validData.length >= 2 ? pathGenerator(validData) : null;

  // X-axis ticks: use data points themselves for sparse data
  $: xTicks = validData.map((d) => new Date(d.timestamp));

  // Tooltip state
  let tooltip = null;

  const showTooltip = (d, event) => {
    const rect = event.target.closest('svg').getBoundingClientRect();
    tooltip = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      score: d.riskScore,
      time: formatTime(d.timestamp),
    };
  };

  const hideTooltip = () => {
    tooltip = null;
  };
</script>

{#if validData.length === 0}
  <div class="text-xs text-gray-400 italic">No chart data available</div>
{:else}
  <svg {width} {height} class="block">
    <g transform="translate({margin.left}, {margin.top})">
      <!-- Zone backgrounds -->
      {#each zones as zone}
        <rect
          x={0}
          y={yScale(zone.y1)}
          width={plotWidth}
          height={yScale(zone.y0) - yScale(zone.y1)}
          fill={zone.color}
        />
        <text
          x={plotWidth + 2}
          y={(yScale(zone.y0) + yScale(zone.y1)) / 2}
          dy="0.35em"
          class="text-[8px] fill-gray-400"
        >{zone.label}</text>
      {/each}

      <!-- Y-axis ticks -->
      {#each yTicks as tick}
        <line
          x1={-4}
          y1={yScale(tick)}
          x2={plotWidth}
          y2={yScale(tick)}
          stroke="#e5e7eb"
          stroke-width="0.5"
        />
        <text
          x={-6}
          y={yScale(tick)}
          dy="0.35em"
          text-anchor="end"
          class="text-[9px] fill-gray-500"
        >{tick}</text>
      {/each}

      <!-- Line path -->
      {#if pathD}
        <path d={pathD} fill="none" stroke="#6366f1" stroke-width="1.5" />
      {/if}

      <!-- Data points -->
      {#each validData as d}
        <circle
          cx={xScale(new Date(d.timestamp))}
          cy={yScale(d.riskScore)}
          r={3}
          fill={pointColor(d.riskScore)}
          stroke="white"
          stroke-width="1"
          class="cursor-pointer"
          on:mouseenter={(e) => showTooltip(d, e)}
          on:mouseleave={hideTooltip}
          role="img"
          aria-label="Risk score {d.riskScore}"
        />
      {/each}

      <!-- X-axis labels -->
      {#each xTicks as tick, i}
        {#if validData.length < 6 || i % Math.ceil(validData.length / 5) === 0}
          <text
            x={xScale(tick)}
            y={plotHeight + 14}
            text-anchor="middle"
            class="text-[8px] fill-gray-500"
          >{formatTime(tick)}</text>
        {/if}
      {/each}
    </g>

    <!-- Tooltip -->
    {#if tooltip}
      <g
        transform="translate({tooltip.x}, {tooltip.y - 28})"
        pointer-events="none"
      >
        <rect
          x={-40}
          y={0}
          width={80}
          height={22}
          rx={3}
          fill="rgba(0,0,0,0.8)"
        />
        <text
          x={0}
          y={14}
          text-anchor="middle"
          class="text-[9px] fill-white"
        >{tooltip.score} — {tooltip.time}</text>
      </g>
    {/if}
  </svg>
{/if}
