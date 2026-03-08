# KiCad 9 → KiCad 8 Schematic Converter

一个基于浏览器的工具，用于将 KiCad 9 格式的原理图文件（`.kicad_sch`）降级转换为 KiCad 8 格式，使其可以在 KiCad 8 中正常打开和编辑。

## 功能特性

- **浏览器端转换**：纯前端实现，无需服务器，文件不会上传到任何地方
- **批量处理**：支持同时上传多个 `.kicad_sch` 文件，一键转换并打包下载
- **版本检测**：自动识别输入文件的 KiCad 版本
- **转换日志**：显示详细的转换过程日志和警告信息

## 转换规则

| 规则 | 说明 |
|------|------|
| R1 | 文件头版本号降级（`version` → `20231120`，`generator_version` → `8.0`） |
| R2 | `pin_names` / `pin_numbers` 中 `(hide yes)` → 裸 `hide` |
| R3 | `pin` 定义中 `(hide yes)` → 裸 `hide` |
| R4 | 移除 `embedded_fonts` 节点 |
| R5 | 调整 sheet pin 中 `uuid` 的位置（移到 `effects` 之后） |
| R6 | 移除 sheet 的 KiCad 9 新属性（`exclude_from_sim`、`in_bom`、`on_board`、`dnp`） |
| R7 | 移除 KiCad 9 专有元素（`table`、`rule_area`、`embedded_files`） |
| R8 | 移除 `text_box` 中的 `margins` 属性及 `text`/`text_box` 中的 `exclude_from_sim` |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 技术栈

- **React** + **Vite** — 前端框架与构建工具
- **S-expression Parser** — 自定义的 KiCad S-表达式解析器（`src/lib/sexpr-parser.js`）
- **Converter** — 基于 AST 的版本转换引擎（`src/lib/converter.js`）

## 项目结构

```
converter/
├── src/
│   ├── lib/
│   │   ├── sexpr-parser.js   # S-expression 解析器和序列化器
│   │   └── converter.js      # KiCad 9 → 8 转换逻辑
│   ├── App.jsx               # 主应用组件（文件上传、转换、下载）
│   └── main.jsx              # 入口文件
├── index.html
├── package.json
└── vite.config.js
```

## 示例文件

`asset/` 目录下提供了用于测试和验证的示例原理图文件：

- **`asset/kicad8/`** — KiCad 8 格式的原始原理图文件
- **`asset/kicad9/`** — KiCad 9 格式的原理图文件（与 kicad8 中的设计内容相同，仅版本不同）

两个文件夹中包含了相同的设计项目，方便对比验证转换结果的正确性：

| 项目 | 说明 |
|------|------|
| `complex_hierarchy/` | 复杂层级原理图 |
| `flat_hierarchy/` | 扁平层级原理图 |
| `pic_programmer/` | PIC 编程器（含多页原理图） |
| `video/` | 视频电路设计 |

> **注意**：`kicad9/` 中还额外包含一个 `multichannel/` 项目，该设计使用了 KiCad 9 独有的多通道功能，在 KiCad 8 中无对应设计。
