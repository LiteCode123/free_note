![free_note 界面展示](docs/images/screenshot.png)

# free_note

**把零散的笔记、账号信息和操作指南，整理成随手可查的本地记录。**

free_note 是一个轻量的个人记事工具：在自己的电脑上运行，用浏览器打开，以分类和搜索快速找到需要的信息。清爽的中文界面、暖色点缀和右侧详情抽屉，让日常记录与查阅更自然。

不需要注册账号，不依赖云端服务；笔记数据保存在本机。适合整理学习笔记、常用资料、操作步骤，以及需要隐藏显示的字段。

## 功能

- **分类管理**：自定义分类，侧栏展示每类记录数量。
- **快速搜索**：同时搜索标题、分类和字段内容，记录按最近更新时间排序。
- **灵活记录**：新建、编辑、删除记录，自由添加字段和多行备注。
- **详情抽屉**：在右侧查看记录，保留列表上下文。
- **敏感字段隐藏与复制**：按字段名称识别密码、密钥、Token 等，默认打码，支持显示切换及一键复制；普通字段也可复制。
- **主密码与本地加密**：首次使用设置主密码，支持手动锁定；字段内容使用 Fernet 加密，主密码通过 PBKDF2-HMAC-SHA256 派生密钥。
- **可选自动进入**：验证主密码后，可切换到自动解锁模式。此模式会把解密密钥保存在数据库中，适合只需要便捷访问的场景。
- **键盘操作**：`/` 聚焦搜索，`N` 新建记录，`Esc` 关闭详情或弹窗。
- **轻量界面**：原生 HTML/CSS/JavaScript，无前端构建步骤；支持窄屏布局及减少动画的系统偏好。

## 快速开始

需要 **Python 3.10 或更新版本**，以及现代浏览器。首次安装依赖需要联网，安装完成后可在本地使用。

### Windows

下载或克隆本仓库，双击 `start.bat`。启动器会创建虚拟环境、检查依赖并启动应用，浏览器随后自动打开。

```powershell
git clone https://github.com/LiteCode123/free_note.git
cd free_note
.\start.bat
```

关闭启动窗口或按 `Ctrl+C` 即可停止服务。如果浏览器没有自动打开，访问 <http://127.0.0.1:8765>。

### 手动启动（Windows / macOS / Linux）

```bash
git clone https://github.com/LiteCode123/free_note.git
cd free_note
python -m venv .venv
```

激活虚拟环境：

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux（系统可能需要使用 python3 创建虚拟环境）
source .venv/bin/activate
```

然后安装依赖并运行：

```bash
python -m pip install -r requirements.txt
python app.py
```

不希望自动打开浏览器时，使用 `python app.py --no-browser`。首次进入时设置至少 6 位的主密码，然后创建自己的第一条记录。

## 数据与密码

- 首次运行自动在项目目录生成 `data.db`，仓库不包含预置数据库或个人笔记。
- **字段名称和值、备注保存在加密内容中；标题、分类和时间戳以明文保存。** 隐藏显示只影响界面呈现。
- 默认模式不保存主密码或直接可用的解密密钥。请妥善保存主密码，当前没有密码找回或重置后恢复记录的功能。
- 自动进入模式会将解密密钥与数据一起保存在 `data.db` 中；取得数据库的人也能取得该密钥。当前没有恢复主密码保护的界面入口。
- 备份前先停止应用，再复制 `data.db`；恢复时停止应用，将备份放回原路径。备份也需要作为私人文件保存。
- 服务默认只监听 `127.0.0.1:8765`，用于个人单机使用。解锁状态由当前服务进程共享，当前实现没有多用户会话隔离，不适合作为公网服务部署。

## 项目结构

```text
free_note/
├── app.py                  # Flask 接口、SQLite 存储与加密逻辑
├── static/
│   ├── index.html          # 中文界面
│   ├── style.css           # 样式与响应式布局
│   └── app.js              # 搜索、表单、抽屉与快捷键
├── docs/
│   ├── design.md           # 界面设计说明
│   └── images/screenshot.png
├── tests/test_app.py       # 使用临时数据库的功能测试
├── requirements.txt
├── start.bat               # Windows 首次安装与启动
├── .gitignore              # 排除数据库、虚拟环境及私人文件
└── LICENSE                 # MIT License
```

技术栈：Python · Flask · SQLite · cryptography · HTML · CSS · JavaScript。

## 开发与贡献

欢迎通过 [Issues](https://github.com/LiteCode123/free_note/issues) 反馈问题或提交 Pull Request。反馈时请使用虚构示例，不要附带真实密码、密钥或私人数据库。

安装依赖后，可运行：

```bash
python -m unittest discover -s tests -v
```

测试仅使用临时数据库，覆盖首次设置、锁定/解锁、记录增删改查、搜索、加密存储与自动进入模式。

## 许可证

采用 [MIT License](LICENSE)，允许使用、修改和分发，保留许可证及版权声明即可。
