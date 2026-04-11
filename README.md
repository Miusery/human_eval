# 人工评测系统 - 启动与说明

本项目是一个用于评测机器翻译质量的人工评测系统，包含前后端完整实现，基于 Vue 2、Element-UI 和 Flask + SQLite。

## 如何启动
1. 安装依赖：`pip install -r requirements.txt`
2. 下载自然语言处理数据包（仅首次需要）：`python -m textblob.download_corpora`
3. 启动服务：`python run.py`
4. 访问浏览器：`http://127.0.0.1:5000`

## 使用说明
所有用户配置通过 `config/config.json` 维护，通过修改 `current_user` 切换当前登入用户，支持角色权限（`admin` 与 `annotator`）。
支持多译文打分 (DA)、排序 (RR) 及左键连续划词选择错误类型，系统满足全部UI及逻辑需求。