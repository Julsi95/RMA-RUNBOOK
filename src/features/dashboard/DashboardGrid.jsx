import { useMemo } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const MeasuredGridLayout = WidthProvider(GridLayout);
const RESIZE_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const GRID_ROW_HEIGHT = 10;

export function heightToGridRows(height, gap = 14) {
  return Math.max(1, Math.ceil((Math.max(120, Number(height) || 250) + gap) / (GRID_ROW_HEIGHT + gap)));
}

export function gridRowsToHeight(rows, gap = 14) {
  return Math.max(120, Math.round(rows) * GRID_ROW_HEIGHT + (Math.round(rows) - 1) * gap);
}

export function createDashboardGridLayout(containers, columns = 24, gap = 14) {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const placed = [];
  return containers.map((item) => {
    const width = Math.min(columns, Math.max(1, Math.ceil((Number(item.width) || 12) * columns / 24)));
    const height = heightToGridRows(item.height, gap);
    const hasSavedPosition = Number.isFinite(Number(item.layoutX)) && Number.isFinite(Number(item.layoutY));
    let x = hasSavedPosition ? Number(item.layoutX) : item.columnStart ? Math.round((Number(item.columnStart) - 1) * columns / 24) : cursorX;
    let y = hasSavedPosition ? Number(item.layoutY) : cursorY;
    x = Math.min(columns - width, Math.max(0, x));
    if (!hasSavedPosition && !item.columnStart && x + width > columns) {
      x = 0;
      y = cursorY;
      rowHeight = 0;
    }
    const layoutItem = { i: item.id, x, y, w: width, h: height, minW: 1, maxW: columns, minH: heightToGridRows(120, gap), maxH: heightToGridRows(800, gap) };
    // Older saved drafts can contain overlapping coordinates from the former
    // overlap-enabled builder. Move only those initial collisions below the
    // occupied cards; normal drag/resize interactions are blocked at collisions.
    let collisions = placed.filter((entry) => layoutItem.x < entry.x + entry.w && layoutItem.x + layoutItem.w > entry.x && layoutItem.y < entry.y + entry.h && layoutItem.y + layoutItem.h > entry.y);
    while (collisions.length) {
      layoutItem.y = Math.max(...collisions.map((entry) => entry.y + entry.h));
      collisions = placed.filter((entry) => layoutItem.x < entry.x + entry.w && layoutItem.x + layoutItem.w > entry.x && layoutItem.y < entry.y + entry.h && layoutItem.y + layoutItem.h > entry.y);
    }
    placed.push(layoutItem);
    if (!hasSavedPosition) {
      cursorX = x + width;
      rowHeight = Math.max(rowHeight, height);
      if (cursorX >= columns) {
        cursorX = 0;
        cursorY = y + rowHeight;
        rowHeight = 0;
      } else cursorY = Math.max(cursorY, y);
    }
    return layoutItem;
  });
}

export function DashboardGrid({ containers, gap = 14, viewport = "desktop", editable = false, onLayoutChange, children }) {
  const columns = viewport === "mobile" ? 1 : viewport === "tablet" ? 12 : 24;
  const layout = useMemo(() => createDashboardGridLayout(containers, columns, gap), [containers, columns, gap]);
  return <MeasuredGridLayout
    className="dashboard-layout-grid dashboard-rgl-grid"
    layout={layout}
    cols={columns}
    rowHeight={GRID_ROW_HEIGHT}
    margin={[Math.max(0, Number(gap) || 0), Math.max(0, Number(gap) || 0)]}
    containerPadding={[0, 0]}
    compactType={null}
    allowOverlap={false}
    preventCollision
    isDraggable={editable && viewport === "desktop"}
    isResizable={editable && viewport === "desktop"}
    draggableHandle=".dashboard-drag-handle"
    draggableCancel="input, textarea, select, a, .dashboard-container-tools > div"
    resizeHandles={RESIZE_HANDLES}
    onLayoutChange={editable && viewport === "desktop" ? onLayoutChange : undefined}
  >{children}</MeasuredGridLayout>;
}
