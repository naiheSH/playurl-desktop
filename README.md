# Playurl Desktop

一个以“播放 URL 可见、可复制”为核心的跨平台音乐客户端。桌面端完全使用 Electron、Node.js、Vue 3 与 TypeScript，不依赖 Python 或本机服务环境。

## 当前能力

- 聚合搜索网易云、QQ 音乐、酷狗与汽水音乐
- 登录后聚合各平台的创建、收藏、喜欢与最近播放歌单
- 网易云官方排行榜、热门分类与分类歌单浏览
- 每首歌曲独立显示所属渠道、时长与该平台自己的音质档位
- 按登录账号展示 VIP / SVIP 权益提示，并展示接口实际返回音质
- 每首歌曲可直接解析、显示并复制真实短期播放 URL
- 本地音频代理，支持 Range 和汽水加密流解密
- 网易云、QQ、酷狗网页登录会自动检测授权 Cookie 并关闭；汽水使用客户端内扫码登录
- 登录凭据只保存在 Electron 的本机 `userData/accounts` 目录
- GitHub Actions 构建 Windows NSIS、macOS DMG、Linux AppImage/DEB

> 音质是否可用取决于对应平台账号权益、曲目版权与所在地区。项目不会绕过会员或付费限制。

## 开发

需要 Node.js 22+。

```bash
npm install
npm run dev
```

构建当前平台：

```bash
npm run package
```

## 架构

- `src/main`：Electron 主进程、本机账户登录窗口、本地 API 生命周期
- `src/preload`：最小权限 IPC 桥
- `src/renderer`：Vue 3 客户端界面
- `runtime`：从 Mineradio 稳定实现迁入的 Node 音源兼容层，后续按 provider 逐步拆成 TypeScript 模块

渲染进程关闭 Node 集成并启用上下文隔离；音源服务只监听 `127.0.0.1` 的随机端口。

## 来源与许可

本项目基于 Mineradio 的 GPL-3.0 音源实现重构，继续使用 GPL-3.0-only 许可。第三方音乐平台商标与服务归各自权利人所有。
