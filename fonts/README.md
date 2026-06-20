# 字体文件说明

Gill Sans Ultra Bold 为商业字体，需自行获取字体文件并放置于此目录。

## 使用方式

1. 获取 Gill Sans Ultra Bold 字体文件（.woff2 格式），命名为 `gillsans-ultrabold.woff2`
2. 放入 `fonts/` 目录
3. 页面中的 @font-face 声明已就绪，无需额外修改代码

如果未放置字体文件，@font-face 会自动回退到：
- 系统中已安装的 Gill Sans / Gill Sans MT
- 再回退到 Impact、Arial Black 等粗体系统字体