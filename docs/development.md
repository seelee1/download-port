# 开发与测试

## 环境

- Windows、Python 3.10+，无 Python 第三方依赖。
- Node.js 20+ 用于 JavaScript 单元测试；已验证 Node.js 24、Python 3.12。
- 可选：Playwright 和支持命令行加载扩展的 Chromium 浏览器，用于浏览器集成测试。

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/*.test.mjs
```

Python 测试只操作自动生成的 .test-data 样本，覆盖原生通信、归档、恢复、目录边界及按层分页。JavaScript 测试覆盖路由、配置兼容、并发仅下一次和后台操作。

## 浏览器集成测试

可在单独的开发依赖目录安装 Playwright，再指定模块路径。浏览器必须允许命令行加载解压缩扩展；某些正式 Chrome 版本禁用该方式，可使用 Chrome for Testing。Edge 已通过本机隔离配置验证。

```powershell
$env:PLAYWRIGHT_MODULE = '你的开发依赖目录\node_modules\playwright'
$env:CHROME_EXE = '浏览器可执行文件完整路径'
node tests/browser-integration.cjs
```

脚本使用 .test-data 下的独立浏览器配置、样本目录及临时名称的原生服务，结束时关闭测试浏览器并取消临时服务注册；不会修改日常浏览器配置。测试样本和截图留在 .test-data 供排查。若进程被强制终止，临时注册可能需要手动清理，名称以 com.yule.download_port_test_ 开头；不要误删正式服务注册。

集成测试覆盖浏览与确认分离、路径导航、全目录搜索、弹窗点击区域、固定底部、仅下一次真实下载与归档、更多/返回。通过这些测试不等于完成真实断电或所有存储设备认证。

## 打包

```powershell
python scripts/package.py
```

在 releases 生成版本 ZIP 和 SHA256.txt。采用明确文件清单，包含许可证、当前源码、说明及测试；不包含缓存、数据库、本地备份和测试样本。

extension/manifest.json 的 key 是固定的公开扩展标识，用于让浏览器 ID 与本地服务 allowlist 一致，不是私钥。不要在同一产品升级中随意更换；派生独立产品应同时调整扩展标识和原生服务名称。

## 发布前

1. 运行单元测试和浏览器集成测试，检查工作区差异。
2. 核对 manifest.json、package.json、原生服务版本以及发布说明。
3. 打包并检查 ZIP 内容与 SHA256；从资源管理器验证安装。
4. 源码推送至选定 GitHub 仓库；安装 ZIP 与 SHA256 作为 Release 附件，不提交历史发布包。
