# Tauri 安全配置指南

## 当前配置（开发友好）

```json
// tauri.conf.json
"security": {
  "csp": null,
  "assetProtocol": {
    "enable": true,
    "scope": ["**"]
  }
}
```

**适用场景**: 个人使用、内部工具、开发阶段

---

## 生产环境建议配置

### 1. 限制 CSP（防止 XSS）

```json
"security": {
  "csp": "default-src 'self'; media-src 'self' asset: https://*; img-src 'self' asset: blob: data:;"
}
```

### 2. 限制 Asset Protocol 范围

```json
"assetProtocol": {
  "enable": true,
  "scope": [
    "$HOME/TeslaCam/**",
    "$DESKTOP/**",
    "$DOWNLOAD/**",
    "$DOCUMENT/**"
  ]
}
```

### 3. 限制文件系统权限

```json
// capabilities/default.json
{
  "identifier": "fs:scope",
  "allow": [
    { "path": "$HOME/TeslaCam/**" },
    { "path": "$DESKTOP/**" },
    { "path": "$DOWNLOAD/**" }
  ]
}
```

---

## 跨平台发布清单

### macOS 特定配置

在 `src-tauri/ExportDashCam.app` 需要添加 entitlements:

```xml
<!-- entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
    <key>com.apple.security.files.downloads.read-only</key>
    <true/>
</dict>
</plist>
```

### Windows 特定配置

当前配置工作良好，无需额外设置。

### Linux 特定配置

- AppImage: 可能需要 `--no-sandbox` 参数
- Snap: 需要声明 `removable-media` 接口
- Flatpak: 需要 `--filesystem=host` 权限

---

## 总结

| 配置项 | 当前 | 建议生产环境 |
|--------|------|-------------|
| CSP | null | 设置具体策略 |
| Asset Scope | `**` (所有文件) | 限制在用户目录 |
| FS Scope | `**` | 限制在特定目录 |
| 用户体验 | 无权限提示 | 首次使用可能需要授权 |

**结论**: 当前配置适合快速开发和内部使用。如果要发布到 Mac App Store 或作为正式产品，建议逐步收紧权限。
