"use client";

// F4 内容区：上传控件的"这一半边"——直传函数与状态。
// 流程：assetsApi.uploadFile(file)（upload-url 预签名 PUT 直传 + confirm）→ assetsApi.get 取 viewUrl 预览。
//
// ── 与 F2 的交接点（调用点由 F2 接，本 hook 只提供能力）──
// HeroComposer.tsx：
//   const upload = useAssetUpload();
//   input onChange → void upload.upload(file)
//   上传按钮文案：upload.uploading ? "上传中…" : (upload.fileName ?? dict.composerUpload)
//   成功态：upload.assetId !== null（可展示"已上传"样式）；失败：upload.error 行内小字展示
// AppHomePage.tsx（composer 参考图区，F2 所有）：
//   const upload = useAssetUpload();
//   input onChange → void upload.upload(file)
//   refImg 改存 upload.viewUrl（预览，原 file.name/本地路径逻辑替换）；
//   另存 upload.assetId 待提交（任务提交时放 inputAssetIds；若走 ?img= 深链，提交前先调
//   assetsApi.importUrl({ url: img, kind: "upload" }) 转 assetId，见 PRD §8.3/§8.8 深链闭环）
// 返回的 assetId 由调用方透传给提交链路，本 hook 不碰 composer 提交逻辑。

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { assetsApi } from "@/lib/api/resources";
import type { AssetItem } from "@/lib/api/types";

export interface AssetUploadState {
  // 是否正在直传（含 confirm + 取 viewUrl）
  uploading: boolean;
  // 确认后的资产 id（待提交给任务链路 inputAssetIds）
  assetId: string | null;
  // 15min 有效浏览 URL（供 refImg 预览显示）
  viewUrl: string | null;
  // 当前选择的文件名（供 HeroComposer fileName 显示：上传中/成功态）
  fileName: string | null;
  // 失败信息（行内小字展示，不要 alert()）
  error: string | null;
  // 执行直传；成功返回确认后的资产，失败返回 null 并置 error
  upload: (file: File) => Promise<AssetItem | null>;
  // 清空状态（移除参考图时调用）
  reset: () => void;
}

export function useAssetUpload(): AssetUploadState {
  const [uploading, setUploading] = useState(false);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<AssetItem | null> {
    setUploading(true);
    setError(null);
    setFileName(file.name);
    try {
      // 预签名 PUT 直传 + 服务端 confirm，返回确认后的资产
      const { asset } = await assetsApi.uploadFile(file);
      setAssetId(asset.id);
      try {
        const detail = await assetsApi.get(asset.id);
        setViewUrl(detail.viewUrl);
      } catch {
        // 预览 URL 拿不到不影响主流程（assetId 已就绪可提交）
        setViewUrl(null);
      }
      return asset;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "UNAUTHORIZED") setError("请先登录后再上传");
        else setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "上传失败，请稍后重试");
      }
      setAssetId(null);
      setViewUrl(null);
      return null;
    } finally {
      setUploading(false);
    }
  }

  function reset(): void {
    setAssetId(null);
    setViewUrl(null);
    setFileName(null);
    setError(null);
  }

  return { uploading, assetId, viewUrl, fileName, error, upload, reset };
}
