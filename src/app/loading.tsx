import LoadingScreen from "@/components/LoadingScreen";

/**
 * Next.js App Router 自动加载边界
 * 在页面切换和冷加载时自动显示
 */
export default function Loading() {
  return <LoadingScreen mode="full" text="加载中" showProgress />;
}