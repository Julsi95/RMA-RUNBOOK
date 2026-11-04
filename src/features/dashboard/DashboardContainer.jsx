import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Crown, Medal, Quote } from "lucide-react";
import { Link } from "react-router";
import { getOverallScore, getKpiScoringSettings } from "@/features/kpi/kpi-data";
import { getConsecutiveTopThreeStreak, getImportedKpiRank } from "@/features/kpi/kpi-ranking";
import { useDashboardKpi } from "@/features/dashboard/dashboard-kpi-provider";
import { useDashboardPublicLinks } from "@/features/dashboard/dashboard-public-links-provider";
import { safeAppHref, safeHttpUrl } from "@/lib/safe-url";

function OverflowText({ as: Tag = "p", wrap = true, className = "", style, children }) {
  const [scrolling, setScrolling] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <Tag
    className={`dashboard-overflow-text${className ? ` ${className}` : ""}`}
    data-scrolling={scrolling ? "true" : undefined}
    onScroll={() => {
      setScrolling(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setScrolling(false), 800);
    }}
    style={{ whiteSpace: wrap ? "pre-wrap" : "pre", ...style }}
  >{children}</Tag>;
}

function safeImageSource(value) {
  if (typeof value !== "string" || !value) return "";
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return value;
  try { return safeHttpUrl(new URL(value, window.location.origin).href); } catch { return ""; }
}

function gridColumnStyles(item, width) {
  if (!item.columnStart) return {};
  const start = Math.min(25 - width, Math.max(1, Number(item.columnStart) || 1));
  return {
    "--dashboard-column-start": start,
    "--dashboard-column-start-tablet": Math.ceil(start / 2),
  };
}

function DashboardLink({ url, children, className = "", enabled = true }) {
  const href = safeAppHref(url);
  if (!href) return null;
  if (!enabled) return <span className={className}>{children}</span>;
  if (href.startsWith("/")) return <Link className={className} to={href}>{children}</Link>;
  return <a className={className} href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function colorWithOpacity(color, opacity) {
  const match = /^#([\da-f]{6})$/i.exec(color || "");
  if (!match) return `rgb(23 23 27 / ${Math.max(0, Math.min(100, opacity ?? 74))}%)`;
  const hex = match[1];
  return `rgb(${parseInt(hex.slice(0, 2), 16)} ${parseInt(hex.slice(2, 4), 16)} ${parseInt(hex.slice(4, 6), 16)} / ${Math.max(0, Math.min(100, opacity ?? 74))}%)`;
}

export default function DashboardContainer({ item, linksEnabled = true, containerGap = 14, announcements = [] }) {
  const kpiData = useDashboardKpi();
  const publicLinksData = useDashboardPublicLinks();
  const publicLinks = publicLinksData.links ?? [];
  const imageList = Array.isArray(item.images) && item.images.length ? item.images : item.image ? [{ id: "legacy-image", src: item.image }] : [];
  const images = imageList.map((image) => ({ ...image, src: safeImageSource(image.src) })).filter((image) => image.src);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const hasImage = images.length > 0;
  const isCarousel = hasImage && images.length > 1 && item.imageMode === "carousel";
  const imageSrc = images[Math.min(activeImageIndex, Math.max(0, images.length - 1))]?.src || "";

  useEffect(() => {
    setActiveImageIndex((index) => Math.min(index, Math.max(0, images.length - 1)));
  }, [images.length]);

  useEffect(() => {
    if (!isCarousel) setActiveImageIndex(0);
  }, [isCarousel]);

  useEffect(() => {
    if (!isCarousel || !item.carouselAutoplay) return undefined;
    const interval = Math.max(2, Math.min(10, Number(item.carouselInterval) || 5)) * 1000;
    const timer = window.setInterval(() => setActiveImageIndex((index) => (index + 1) % images.length), interval);
    return () => window.clearInterval(timer);
  }, [images.length, isCarousel, item.carouselAutoplay, item.carouselInterval]);

  function changeImage(direction) {
    setActiveImageIndex((index) => (index + direction + images.length) % images.length);
  }
  if (item.type === "topAgents" || item.type === "kpiResult") {
    const availableMonths = Object.entries(kpiData.months ?? {}).filter(([, month]) =>
      Object.keys(month.records ?? {}).length && (item.type !== "topAgents" || month.status === "published"),
    );
    const [monthKey, month] = availableMonths.sort(([a], [b]) => b.localeCompare(a))[0] ?? [kpiData.recognition?.monthKey ?? "", null];
    const settings = month?.scoringSettings ?? getKpiScoringSettings();
    const knownMembers = new Map((kpiData.members ?? []).map((member) => [member.id, member]));
    const ranked = Object.entries(month?.records ?? {}).map(([memberId, record]) => {
      const member = knownMembers.get(memberId);
      const explicitRank = getImportedKpiRank(record);
      const importedRank = record.source === "import" ? String(record.metrics?._importedRank ?? "").trim() : "";
      const importedScore = record.overallScore !== "" && record.overallScore != null && Number.isFinite(Number(record.overallScore));
      return { ...record, memberId, memberName: member?.name || record.memberName || "Former roster member", role: member?.role || record.role, computedScore: record.source === "import" && importedScore ? Number(record.overallScore) : getOverallScore(record, settings), importedRank, explicitRank: Number.isFinite(explicitRank) ? explicitRank : null };
    }).filter(Boolean).sort((a, b) => {
      if (a.explicitRank != null && b.explicitRank != null && a.explicitRank !== b.explicitRank) return a.explicitRank - b.explicitRank;
      if (a.explicitRank != null && b.explicitRank == null) return -1;
      if (a.explicitRank == null && b.explicitRank != null) return 1;
      return b.computedScore - a.computedScore || a.memberName.localeCompare(b.memberName);
    });
    const displayAgents = kpiData.recognition?.agents?.length
      ? kpiData.recognition.agents
      : ranked.map((agent, index) => {
        const rank = agent.explicitRank ?? index + 1;
        const streakMonths = getConsecutiveTopThreeStreak(
          kpiData.months ?? {},
          agent.memberId,
          monthKey,
          (record) => {
            if (record.source === "import") {
              return record.overallScore !== "" && record.overallScore != null && Number.isFinite(Number(record.overallScore))
                ? Number(record.overallScore)
                : 0;
            }
            return getOverallScore(record, record.scoringSettings ?? getKpiScoringSettings());
          },
        );
        return { ...agent, rank, streakMonths, photo: knownMembers.get(agent.memberId)?.photo ?? "" };
      }).filter((agent) => agent.rank >= 1 && agent.rank <= 3).slice(0, 3);
    const scoreLabel = (value) => `${Number(value).toFixed(2)} / 5`;
    const monthLabel = monthKey ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthKey}-01T00:00:00Z`)) : "No published month";
    const width = Math.min(24, Math.max(1, Number(item.width) || 12));
    const height = Math.max(item.type === "topAgents" ? 320 : 120, Number(item.height) || 250);
    return <article className={`dashboard-content-card dashboard-kpi-widget dashboard-kpi-${item.type}`} style={{ "--dashboard-span-desktop": width, "--dashboard-span-tablet": Math.min(12, Math.ceil(width / 2)), ...gridColumnStyles(item, width), "--dashboard-height": `${height}px`, "--dashboard-row-span": Math.ceil(height + Math.max(0, Number(containerGap) || 0)) }} data-dashboard-container={item.id}>
      <div className="dashboard-kpi-widget-head">
        <div className="dashboard-kpi-widget-head-inner">
          <span className="dashboard-card-kicker">{item.type === "topAgents" ? "TOP OF THE MONTH" : "MONTHLY KPI"}</span>
           <p>{monthLabel}</p>
          {/* <div className="dashboard-kpi-widget-title-row">
            <h2>{item.title || (item.type === "topAgents" ? "Top Agents" : "KPI Result")}</h2>
          </div> */}
        </div>
        {/* <span className="dashboard-kpi-widget-mark">{item.type === "topAgents" ? "TOP 3" : "KPI"}</span> */}
      </div>
      {(kpiData.loading || kpiData.rosterLoading) && !displayAgents.length && !ranked.length ? <p className="dashboard-kpi-widget-state">Loading recognition…</p>
        : item.type === "topAgents" ? displayAgents.length ? <ol className="dashboard-top-agents-list" tabIndex={0} aria-label="Monthly top three agents">{displayAgents.slice(0, 3).map((agent, index) => <li className={`dashboard-agent-row dashboard-agent-place-${index + 1}${index === 0 ? " is-champion" : ""}`} key={agent.memberId}>
          <span className="dashboard-agent-border-glitter" aria-hidden="true" />
          <div className="dashboard-agent-card-heading"><span className="dashboard-agent-rank">{agent.rank ?? agent.importedRank ?? String(index + 1).padStart(2, "0")}</span>
          <span className="dashboard-agent-name"><strong>{agent.memberName ?? agent.name}</strong></span>
          <span className="dashboard-agent-award"><b>{Number(agent.streakMonths) || 1}×</b><span className="dashboard-agent-award-icon"><Medal size={index === 0 ? 17 : 14} aria-label={`${Number(agent.streakMonths) || 1} month Top 3 streak`} /></span></span></div>
          <span className="dashboard-agent-avatar-shell">{agent.photo && <img className="dashboard-agent-avatar-backdrop" src={safeImageSource(agent.photo)} alt="" onError={(event) => { event.currentTarget.remove(); }} />}<span className="dashboard-agent-avatar"><span>{String(agent.memberName ?? agent.name ?? "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"}</span>{agent.photo && <img src={safeImageSource(agent.photo)} alt="" onError={(event) => { event.currentTarget.remove(); }} />}</span></span>
          {index === 0 && <span className="dashboard-agent-crown" aria-hidden="true"><Crown size={16} fill="currentColor" /></span>}
            <span className="dashboard-agent-card-details"><span className="dashboard-agent-card-label">MONTHLY RECOGNITION</span><small>{Number(agent.streakMonths) || 1}-month Top Agent streak</small><span className="dashboard-agent-card-copy">A place among this month’s top performers.</span></span>
        </li>)}</ol> : <p className="dashboard-kpi-widget-state">No published Top 3 recognition for this month yet.</p>
          : !ranked.length ? <p className="dashboard-kpi-widget-state">No KPI results have been published yet.</p>
            : <div className="dashboard-kpi-result-grid"><div><span>Team average</span><strong>{scoreLabel(ranked.reduce((total, record) => total + record.computedScore, 0) / ranked.length)}</strong></div><div><span>Published agents</span><strong>{ranked.length}</strong></div><div><span>Top result</span><strong>{scoreLabel(ranked[0].computedScore)}</strong><small>{ranked[0].memberName}</small></div></div>}
      {kpiData.error && <small className="dashboard-kpi-widget-error">KPI data could not be refreshed.</small>}
    </article>;
  }
  if (item.type === "recentAnnouncements") {
    const recent = [...announcements].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))).slice(0, Math.min(8, Math.max(1, Number(item.announcementLimit) || 4)));
    const width = Math.min(24, Math.max(1, Number(item.width) || 12));
    const height = Math.max(120, Number(item.height) || 270);
    return <article className="dashboard-content-card dashboard-content-recentAnnouncements" style={{ "--dashboard-span-desktop": width, "--dashboard-span-tablet": Math.min(12, Math.ceil(width / 2)), ...gridColumnStyles(item, width), "--dashboard-height": `${height}px`, "--dashboard-row-span": Math.ceil(height + Math.max(0, Number(containerGap) || 0)) }} data-dashboard-container={item.id}>
      <div className="dashboard-card-inner"><span className="dashboard-card-kicker">TEAM UPDATES</span><h2>{item.title || "Recent announcements"}</h2>
        {recent.length ? <div className="dashboard-recent-announcements">{recent.map((announcement) => <article className="dashboard-recent-announcement" key={announcement.id}><div><strong>{announcement.title || "Team announcement"}</strong>{announcement.date && <time dateTime={announcement.date}>{formatDate(announcement.date)}</time>}</div>{announcement.body && <OverflowText className="dashboard-card-body" wrap={announcement.bodyWrap !== false}>{announcement.body}</OverflowText>}{announcement.description && <OverflowText className="dashboard-card-description" wrap={announcement.descriptionWrap !== false}>{announcement.description}</OverflowText>}</article>)}</div>
          : <p className="dashboard-kpi-widget-state">No announcements have been published yet.</p>}
      </div>
    </article>;
  }
  const textLayers = (item.textLayers ?? []).filter((layer) => layer.text?.trim());
  const dashboardLinks = item.type === "quickLinks" ? publicLinks.filter((link) => link.publicVisible && link.name && safeAppHref(link.url)) : [];
  const hasBaseText = Boolean(item.eyebrow || item.title || item.description || item.body || (item.type === "announcement" && item.showDate && item.date) || item.buttonLabel || (item.type === "quickLinks" && dashboardLinks.length));
  const hasText = hasBaseText || textLayers.length > 0;
  const overlay = hasImage && hasText && (textLayers.length > 0 || (hasBaseText && item.textPosition && item.textPosition !== "below"));
  const imageFillsCard = hasImage && (overlay || !hasText);
  const typeLabel = item.type === "quickLinks" ? "QUICK ACCESS" : item.type === "announcement" ? "ANNOUNCEMENT" : item.type === "content" ? "NOTE" : "";
  const kicker = item.eyebrow || typeLabel;
  const width = Math.min(24, Math.max(1, Number(item.width) || 12));
  const height = Math.max(120, Number(item.height) || 250);
  const style = {
    "--dashboard-span-desktop": width,
    "--dashboard-span-tablet": Math.min(12, Math.max(1, Math.ceil(width / 2))),
    ...gridColumnStyles(item, width),
    "--dashboard-height": `${height}px`,
    "--dashboard-row-span": Math.ceil(height + Math.max(0, Number(containerGap) || 0)),
    "--dashboard-image-fit": item.imageFit === "contain" ? "contain" : "cover",
    "--dashboard-text-color": item.textColor || "#ffffff",
    "--dashboard-overlay-bg": item.textBackground === "none" ? "transparent" : item.textBackground === "solid" ? item.textBackgroundColor || "#17171b" : colorWithOpacity(item.textBackgroundColor, item.textBackgroundOpacity),
    "--dashboard-overlay-blur": item.textBackground === "glass" ? "12px" : "0px",
  };
  const className = "dashboard-content-card dashboard-content-" + item.type + (hasImage && !hasText ? " dashboard-image-only" : "") + (overlay ? ` dashboard-text-overlay overlay-${item.textPosition} overlay-bg-${item.textBackground || "none"}` : "") + (item.imageLayout === "side" && hasImage && !overlay ? " dashboard-side-image" : "") + (isCarousel ? " has-image-carousel" : "");
  const imageLayer = <div className={"dashboard-card-image " + (imageFillsCard ? "image-fill" : "image-" + (item.imageLayout || "banner"))}>
    <img key={imageSrc} className={isCarousel ? `dashboard-carousel-image effect-${item.carouselEffect === "fade" ? "fade" : "slide"}` : ""} src={imageSrc} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
    {isCarousel && item.carouselControls !== false && <div className="dashboard-carousel-controls" aria-label="Image carousel controls">
      <button type="button" aria-label="Previous image" onClick={() => changeImage(-1)}><ChevronLeft size={16} /></button>
      <span>{activeImageIndex + 1}<i>/</i>{images.length}</span>
      <button type="button" aria-label="Next image" onClick={() => changeImage(1)}><ChevronRight size={16} /></button>
    </div>}
    {isCarousel && item.carouselIndicators !== false && <div className="dashboard-carousel-indicators" aria-label="Choose carousel image">{images.map((image, index) => <button type="button" key={image.id || image.src} aria-label={`Show image ${index + 1}`} aria-current={index === activeImageIndex ? "true" : undefined} className={index === activeImageIndex ? "active" : ""} onClick={() => setActiveImageIndex(index)} />)}</div>}
  </div>;
  return <article id={item.type === "announcement" ? `announcement-${item.id}` : undefined} className={className} style={style} data-dashboard-container={item.id}>
    {hasImage && imageLayer}
    {hasBaseText && <div className={"dashboard-card-inner" + (hasImage && item.textPosition && item.textPosition !== "below" ? " is-overlay" : "")} style={hasImage && item.textPosition && item.textPosition !== "below" ? { position: "absolute", zIndex: 2, background: item.textBackground === "none" ? "transparent" : undefined } : undefined}>
      {(kicker || item.type === "announcement") && <div className="dashboard-card-kicker-row">{kicker && <span className="dashboard-card-kicker">{kicker}</span>}{item.type === "announcement" && <span className="dashboard-announcement-spark" aria-hidden="true"><i /><i /><i /></span>}</div>}
      {item.title && <h2>{item.title}</h2>}
      {item.description && <OverflowText className="dashboard-card-description" wrap={item.descriptionWrap !== false}>{item.description}</OverflowText>}
      {item.type === "announcement" && item.body && <OverflowText className="dashboard-card-body" wrap={item.bodyWrap !== false}>{item.body}</OverflowText>}
      {item.type === "content" && item.body && <blockquote><Quote size={17} /><OverflowText as="span" className="dashboard-card-body" wrap={item.bodyWrap !== false}>{item.body}</OverflowText></blockquote>}
      {item.type === "feature" && item.body && <OverflowText className="dashboard-card-body" wrap={item.bodyWrap !== false}>{item.body}</OverflowText>}
      {item.type === "announcement" && item.showDate && item.date && <div className="dashboard-card-date"><CalendarDays size={14} />{formatDate(item.date)}</div>}
      {item.type === "quickLinks" && <div className="dashboard-quick-links">{dashboardLinks.length ? dashboardLinks.map((link) => <DashboardLink className="dashboard-quick-link" url={link.url} enabled={linksEnabled} key={link.id}><span className="dashboard-quick-link-name"><strong>{link.name}</strong>{link.group && <small>{link.group}</small>}</span><ChevronRight size={15} /></DashboardLink>) : <p className="dashboard-quick-links-state">{publicLinksData.loading ? "Loading public links…" : publicLinksData.error ? "Public links could not be loaded." : "No public app links are available."}</p>}</div>}
      {item.buttonLabel && item.buttonUrl && <DashboardLink className="dashboard-card-cta" url={item.buttonUrl} enabled={linksEnabled}>{item.buttonLabel}{item.buttonUrl.startsWith("/") ? <ArrowRight size={15} /> : <ArrowUpRight size={15} />}</DashboardLink>}
    </div>}
    {textLayers.map((layer) => {
      const anchor = layer.anchor || "top-left";
      const x = Math.min(100, Math.max(0, Number(layer.x) || 0));
      const y = Math.min(100, Math.max(0, Number(layer.y) || 0));
      const translateX = anchor.endsWith("center") || anchor === "center" ? "-50%" : anchor.endsWith("right") ? "-100%" : "0";
      const translateY = anchor.startsWith("bottom") ? "-100%" : anchor.startsWith("center") || anchor === "center" ? "-50%" : "0";
      return <OverflowText as="div" className="dashboard-custom-text-layer" key={layer.id} wrap={layer.wrap !== false} style={{ left: `${x}%`, top: `${y}%`, width: `${Math.min(100, Math.max(10, Number(layer.width) || 55))}%`, height: `${Math.min(100, Math.max(10, Number(layer.height) || 45))}%`, transform: `translate(${translateX}, ${translateY})`, color: layer.color || "#ffffff", fontSize: `${layer.fontSize || 24}px`, fontWeight: layer.fontWeight || 600, fontStyle: layer.fontStyle || "normal", fontFamily: layer.fontFamily || "sans-serif", textAlign: layer.align || "left" }}>{layer.text}</OverflowText>;
    })}
    {item.type === "announcement" && hasText && <span className="dashboard-announcement-orbit" aria-hidden="true" />}
  </article>;
}
