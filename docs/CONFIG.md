# 配置：本机路径

这套工具原本是在一台 Windows 机器上长出来的，脚本里有不少绝对路径。开源版本的做法是：**能改参数的改参数，改不了的集中在这里说明**。

## 需要你改的

### 1. 工作区根目录

多数脚本默认工作区是 `D:/deepseek`。两种改法：

- 直接改脚本里的常量，或
- 设环境变量 `DSH_WORKSPACE`，然后把脚本里的绝对路径换成它

### 2. ffmpeg

`cine.mjs` / `stitch.mjs` 需要 ffmpeg：

```powershell
# 方式一：装到 PATH
winget install Gyan.FFmpeg

# 方式二：改 cine.mjs 顶部的 ff 常量
$env:FFMPEG = 'C:\path\to\ffmpeg.exe'
```

### 3. 浏览器调试端口

所有浏览器自动化都连 `http://127.0.0.1:9222`。启动 Edge：

```powershell
msedge.exe --remote-debugging-port=9222 --user-data-dir=D:\edge-profile https://chatgpt.com/
```

第一次需要手动登录 ChatGPT / B 站，之后 profile 会记住。

### 4. GPT 驱动插件

`gen-bgs.mjs` / `deck-cover.mjs` 依赖 `dsh-tool-gpt-driver`：

```powershell
dsh plugin add dsh-tool-gpt-driver
```

它们通过 `import('.../dsh-gpt-driver/src/index.js')` 调用，路径按你的安装位置改。

### 5. DSH profile

`<DSH_PROFILE>` 指 `%USERPROFILE%\.dsh\profiles\web`。

## 端口约定

| 端口 | 用途 |
|---|---|
| 9222 | Edge 远程调试（所有自动化的底座） |
| 3099 | GPT 控制台 |
| 3100 | 浏览器控制台 |
| 3101 | 启动面板 |
| 6060 | ppt-master 的实时预览（临时） |
