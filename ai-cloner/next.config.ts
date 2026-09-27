import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  async redirects() {
    // 深链归一（UI-DIFF 报告 P0）：
    // - EN 内容在根路径（/），/en/* 只保留真实存在的 /en/app；
    // - deevid 的工具/法务/模型/应用深链在本站无对应页面时，
    //   一律 308 到本站最接近的真实页面，避免 404。
    // ⚠️ redirects 先于文件系统匹配，真实存在的路径绝不能写进 source。

    /** deevid 工具页 slug → 本站 ?tool= 视图 */
    const toolMap: Record<string, string> = {      "video-to-video": "video",
      "reference-to-video": "video",
      "ai-video-generator": "video",
      "motion-control": "video",
      "pdf-to-video": "video",
      "ppt-to-video": "video",
      "video-to-prompt": "video",
      "3d-render-to-video": "video",
      "ai-video-editor": "editor",
      "lip-sync-ai": "avatar",
      "video-translator": "translate",
      "ai-avatar": "avatar",
      "ai-music-generator": "audio",
      "text-to-speech": "audio",
      "ai-ad": "viral",
      "viral-video-clone": "viral",
      "ai-video-tools": "explore",
      explore: "explore",
      "ai-image-generator": "image",
      "ai-image-editor": "image",
      "image-to-prompt": "image",
      "ai-anime-generator": "image",
      "ai-photo-editor": "image",
      "text-to-image": "image",
      "ai-image-translator": "image",
      "ai-logo-generator": "image",
      "change-image-background": "image",
      "oc-maker": "image",
      template: "explore",
    };

    /** /app 子页 → 工作台视图 */
    const appSubMap: Record<string, string> = {      editor: "editor",
      workflow: "canvas",
      "viral-studio": "viral",
      dev: "explore",
    };

    /** /app/explore/<slug> → 工作台视图 */
    const exploreMap: Record<string, string> = {      "ai-ad": "viral",
      "ai-avatar": "avatar",
      "ai-image-generator": "image",
      "ai-music-generator": "audio",
      "image-to-video": "video",
      "text-to-speech": "audio",
    };

    // 法务/内容页（本站只有根级 EN 实页）
    const legalSlugs = [
      "terms",
      "privacy-policy",
      "content-policy",
      "contact-us",
      "blog",
      "affiliate",
    ];

    const rules: Array<{ source: string; destination: string; permanent: boolean }> = [      // ---- /en 前缀归一（/en/app 是真实页，绝不能进 source） ----
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/pricing", destination: "/pricing", permanent: true },
      { source: "/en/text-to-video", destination: "/text-to-video", permanent: true },
      { source: "/en/image-to-video", destination: "/image-to-video", permanent: true },
      { source: "/en/grow-your-channel", destination: "/grow-your-channel", permanent: true },
      { source: "/en/guide/viral-studio", destination: "/guide/viral-studio", permanent: true },
      { source: "/en/app/pricing", destination: "/pricing", permanent: true },
      // ---- 根级缺失页 ----
      { source: "/app", destination: "/en/app", permanent: true }, // 工作台实际在 /en/app
      { source: "/home", destination: "/", permanent: true }, // deevid SEO 旧首页
      { source: "/blog/:slug", destination: "/blog", permanent: true }, // 博客文章深链 → 列表
      { source: "/model/:slug", destination: "/", permanent: true }, // 模型展示页 → 首页模型墙
    ];

    // 根级 EN 工具页
    for (const [slug, tool] of Object.entries(toolMap)) {
      rules.push({ source: `/${slug}`, destination: `/en/app?tool=${tool}`, permanent: true });
    }
    // 根级 /app 子页与 explore 深链
    for (const [slug, tool] of Object.entries(appSubMap)) {
      rules.push({ source: `/app/${slug}`, destination: `/en/app?tool=${tool}`, permanent: true });
    }
    for (const [slug, tool] of Object.entries(exploreMap)) {
      rules.push({
        source: `/app/explore/${slug}`,
        destination: `/en/app?tool=${tool}`,
        permanent: true,
      });
    }
    // /en/app 下的同名深链（/en/app 本体是真实页，只匹配子路径）
    for (const [slug, tool] of Object.entries(appSubMap)) {
      rules.push({
        source: `/en/app/${slug}`,
        destination: `/en/app?tool=${tool}`,
        permanent: true,
      });
    }
    for (const [slug, tool] of Object.entries(exploreMap)) {
      rules.push({
        source: `/en/app/explore/${slug}`,
        destination: `/en/app?tool=${tool}`,
        permanent: true,
      });
    }

    // ---- 各语言前缀（真实页只有 7 个：/ /pricing /text-to-video /image-to-video
    //      /grow-your-channel /guide/viral-studio /app） ----
    const locales = ["zh-TW", "zh-CN", "ja", "de", "fr", "ru", "es", "ko", "pt", "it"];    for (const lc of locales) {
      // deevid 工具页 slug（各语言下本站均无实页）
      for (const [slug, tool] of Object.entries(toolMap)) {
        rules.push({
          source: `/${lc}/${slug}`,
          destination: `/${lc}/app?tool=${tool}`,
          permanent: true,
        });
      }
      // 法务/内容页：本站只有根级 EN 实页（所有语言的页脚公司链接都指向它们）
      for (const slug of legalSlugs) {
        rules.push({ source: `/${lc}/${slug}`, destination: `/${slug}`, permanent: true });
      }
      // /{lc}/app 子深链
      for (const [slug, tool] of Object.entries(appSubMap)) {
        rules.push({
          source: `/${lc}/app/${slug}`,
          destination: `/${lc}/app?tool=${tool}`,
          permanent: true,
        });
      }
      for (const [slug, tool] of Object.entries(exploreMap)) {
        rules.push({
          source: `/${lc}/app/explore/${slug}`,
          destination: `/${lc}/app?tool=${tool}`,
          permanent: true,
        });
      }
      // 各语言没有 /app/video 实页（只有根级有）
      rules.push({ source: `/${lc}/app/video`, destination: `/${lc}/app`, permanent: true });
      rules.push({ source: `/${lc}/model/:slug`, destination: `/${lc}`, permanent: true });
      rules.push({ source: `/${lc}/home`, destination: `/${lc}`, permanent: true });
    }

    return rules;
  },
};

export default nextConfig;
