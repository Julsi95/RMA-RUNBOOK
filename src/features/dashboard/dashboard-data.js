export const DASHBOARD_STORAGE_KEY = "starter-app-dashboard-published-v1";
export const DASHBOARD_DRAFT_KEY = "starter-app-dashboard-draft-v1";

export const CONTAINER_TYPES = [
  { value: "announcement", label: "Announcement" },
  { value: "feature", label: "Feature" },
  { value: "content", label: "Simple content" },
  { value: "quickLinks", label: "Quick links" },
  { value: "topAgents", label: "Top Agents" },
  { value: "kpiResult", label: "KPI Result" },
];

const LEGACY_WIDTHS = { small: 6, medium: 8, half: 12, wide: 16, full: 24 };
const LEGACY_HEIGHTS = { compact: 190, regular: 250, tall: 340 };

export const CONTAINER_TYPE_LABELS = Object.fromEntries(CONTAINER_TYPES.map((item) => [item.value, item.label]));

export function createDefaultDashboard() {
  return {
    pageTitle: "Good morning",
    pageDescription: "A clear view of what’s happening across your team.",
    containerGap: 14,
    canvasPadding: 0,
    canvasHeight: 560,
    containers: [
      {
        id: "welcome-announcement",
        publicVisible: true,
        type: "announcement",
        title: "A home base for the whole team",
        description: "Keep important updates, useful links, and team highlights in one place.",
        body: "Make this dashboard yours. Open Dashboard Settings to shape the page around the way your team works.",
        date: new Date().toISOString().slice(0, 10),
        image: "",
        buttonLabel: "Meet the team",
        buttonUrl: "/agent-profiles",
        size: "wide",
        width: 18,
        height: 300,
        showDate: true,
        imageLayout: "banner",
        imageFit: "cover",
        textPosition: "below",
        textBackground: "none",
        textBackgroundColor: "#17171b",
        textBackgroundOpacity: 74,
        textColor: "#ffffff",
        textLayers: [],
        links: [],
      },
      {
        id: "team-feature",
        publicVisible: true,
        type: "feature",
        title: "Meet your people",
        description: "Keep birthdays, milestones, and team details close at hand.",
        body: "",
        date: "",
        image: "",
        buttonLabel: "View profiles",
        buttonUrl: "/agent-profiles",
        size: "medium",
        width: 12,
        height: 250,
        showDate: false,
        imageLayout: "banner",
        imageFit: "cover",
        textPosition: "below",
        textBackground: "none",
        textBackgroundColor: "#17171b",
        textBackgroundOpacity: 74,
        textColor: "#ffffff",
        textLayers: [],
        links: [],
      },
      {
        id: "quick-access",
        publicVisible: true,
        type: "quickLinks",
        title: "Quick access",
        description: "Jump straight into the tools you use every day.",
        body: "",
        date: "",
        image: "",
        buttonLabel: "",
        buttonUrl: "",
        size: "medium",
        width: 12,
        height: 250,
        showDate: false,
        imageLayout: "banner",
        imageFit: "cover",
        textPosition: "below",
        textBackground: "none",
        textBackgroundColor: "#17171b",
        textBackgroundOpacity: 74,
        textColor: "#ffffff",
        textLayers: [],
        links: [
          { id: "link-org", label: "Organization chart", url: "/organizational" },
          { id: "link-schedule", label: "Work schedule", url: "/work-schedule" },
          { id: "link-kpi", label: "Monthly KPI / QA", url: "/kpi-qa" },
        ],
      },
    ],
  };
}

function normalizeDashboard(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.containers)) return null;
  return {
    pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : "Good morning",
    pageDescription: typeof value.pageDescription === "string" ? value.pageDescription : "",
    containerGap: Number.isFinite(Number(value.containerGap)) ? Math.min(40, Math.max(4, Number(value.containerGap))) : 14,
    canvasPadding: Number.isFinite(Number(value.canvasPadding)) ? Math.min(48, Math.max(0, Number(value.canvasPadding))) : 0,
    canvasHeight: Number.isFinite(Number(value.canvasHeight)) ? Math.min(1600, Math.max(380, Number(value.canvasHeight))) : 560,
    containers: value.containers.filter((item) => item && item.id).map((item) => ({
      type: CONTAINER_TYPES.some((type) => type.value === item.type) ? item.type : "content",
      title: typeof item.title === "string" ? item.title : "",
      eyebrow: typeof item.eyebrow === "string" ? item.eyebrow : "",
      description: "",
      body: "",
      date: "",
      image: "",
      buttonLabel: "",
      buttonUrl: "",
      width: 12,
      height: 250,
      publicVisible: true,
      showDate: false,
      imageLayout: "banner",
      imageFit: "cover",
      images: [],
      imageMode: "single",
      carouselEffect: "slide",
      carouselAutoplay: false,
      carouselInterval: 5,
      carouselControls: true,
      carouselIndicators: true,
      textPosition: "below",
      textBackground: "none",
      textBackgroundColor: "#17171b",
      textBackgroundOpacity: 74,
      textColor: "#ffffff",
      textLayers: [],
      ...item,
      width: Math.min(24, Math.max(1, Number(item.width) || LEGACY_WIDTHS[item.size] || 12)),
      height: Math.min(800, Math.max(120, Number(item.height) || LEGACY_HEIGHTS[item.height] || 250)),
      publicVisible: item.type === "topAgents" || item.type === "kpiResult" ? false : true,
      images: Array.isArray(item.images) ? item.images.map((entry, index) => ({ id: entry?.id || `image-${item.id}-${index}`, src: typeof entry?.src === "string" ? entry.src : "" })) : (typeof item.image === "string" && item.image ? [{ id: `image-${item.id}-0`, src: item.image }] : []),
      image: typeof item.image === "string" ? item.image : "",
      imageMode: item.imageMode === "single" ? "single" : (Array.isArray(item.images) && item.images.length > 1 ? "carousel" : "single"),
      carouselEffect: item.carouselEffect === "fade" ? "fade" : "slide",
      carouselAutoplay: Boolean(item.carouselAutoplay),
      carouselInterval: Math.min(10, Math.max(2, Number(item.carouselInterval) || 5)),
      carouselControls: item.carouselControls !== false,
      carouselIndicators: item.carouselIndicators !== false,
      links: Array.isArray(item.links) ? item.links : [],
      topAgentsLimit: Math.min(10, Math.max(1, Number(item.topAgentsLimit) || 3)),
      textLayers: Array.isArray(item.textLayers) ? item.textLayers.map((layer, index) => ({
        id: layer?.id || `text-${item.id}-${index}`,
        text: typeof layer?.text === "string" ? layer.text : "",
        x: Math.min(100, Math.max(0, Number(layer?.x ?? 12))),
        y: Math.min(100, Math.max(0, Number(layer?.y ?? 18))),
        anchor: ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"].includes(layer?.anchor) ? layer.anchor : "top-left",
        fontSize: Math.min(96, Math.max(10, Number(layer?.fontSize) || 24)),
        fontWeight: [300, 400, 500, 600, 700, 800, 900].includes(Number(layer?.fontWeight)) ? Number(layer.fontWeight) : 600,
        fontStyle: layer?.fontStyle === "italic" ? "italic" : "normal",
        fontFamily: ["sans-serif", "serif", "monospace", "Georgia", "Arial", "system-ui"].includes(layer?.fontFamily) ? layer.fontFamily : "sans-serif",
        color: /^#[\da-f]{6}$/i.test(layer?.color || "") ? layer.color : "#ffffff",
        align: ["left", "center", "right"].includes(layer?.align) ? layer.align : "left",
      })) : [],
    })),
  };
}

function readKey(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalizeDashboard(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function readPublishedDashboard() {
  return readKey(DASHBOARD_STORAGE_KEY) ?? createDefaultDashboard();
}

export function readDashboardDraft() {
  return readKey(DASHBOARD_DRAFT_KEY);
}

export function publishDashboard(dashboard) {
  localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboard));
  localStorage.removeItem(DASHBOARD_DRAFT_KEY);
}

export function persistDashboardDraft(dashboard) {
  localStorage.setItem(DASHBOARD_DRAFT_KEY, JSON.stringify(dashboard));
}

export function clearDashboardDraft() {
  localStorage.removeItem(DASHBOARD_DRAFT_KEY);
}

export function makeContainer(type = "feature") {
  const names = {
    announcement: "New announcement",
    feature: "Featured content",
    content: "Your message",
    quickLinks: "Quick links",
    topAgents: "Top Agents",
    kpiResult: "KPI Result",
  };
  return {
    id: globalThis.crypto?.randomUUID?.() ?? "dashboard-" + Date.now() + "-" + Math.random().toString(16).slice(2),
    type,
    title: names[type] ?? "New section",
    eyebrow: "",
    description: "",
    body: "",
    date: type === "announcement" ? new Date().toISOString().slice(0, 10) : "",
    image: "",
    images: [],
    imageMode: "single",
    carouselEffect: "slide",
    carouselAutoplay: false,
    carouselInterval: 5,
    carouselControls: true,
    carouselIndicators: true,
    buttonLabel: "",
    buttonUrl: "",
    width: type === "announcement" ? 18 : 12,
    height: 270,
    publicVisible: true,
    showDate: type === "announcement",
    imageLayout: "banner",
    imageFit: "cover",
    textPosition: "below",
    textBackground: "none",
    textBackgroundColor: "#17171b",
    textBackgroundOpacity: 74,
    textColor: "#ffffff",
    textLayers: [],
    links: type === "quickLinks" ? [{ id: "quick-" + Date.now(), label: "New link", url: "/" }] : [],
    topAgentsLimit: 3,
  };
}
