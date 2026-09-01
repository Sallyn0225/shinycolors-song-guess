---
name: 🐛 Bug 报告
description: 游戏行为不符合预期、报错、体验问题
labels: ["bug"]
---
body:
  - type: checkboxes
    id: self-check
    attributes:
      label: 提交前自查（克隆后跑不起来多半卡在这里）
      description: 全部勾选后再提交，能解决一大半「启动报错」类问题
      options:
        - label: 我读过 README 的「重要提示」——音源不入库、也不提供下载，这是预期行为不是 bug
        - label: 服务端报「曲库为空」时，我知道要先跑 `pnpm assets all`（需要自备音源 + ffmpeg）
        - label: 我本地 ffmpeg 在 PATH 里（`ffmpeg -version` 能跑）
  - type: textarea
    id: what-happened
    attributes:
      label: 发生了什么
      description: 想做什么操作时出了什么问题；有报错请贴完整报错文本或截图
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: 复现步骤
      description: 从打开页面开始，一步步写清怎么走到这个问题
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: 预期是什么
    validations:
      required: true
  - type: dropdown
    id: mode
    attributes:
      label: 模式
      options:
        - 单机四选一
        - 联机 1v1（空札領地戦）
        - 两者都有
    validations:
      required: true
  - type: textarea
    id: env
    attributes:
      label: 环境
      description: 浏览器及版本；部署形态（本地 dev / docker compose / 反代+TLS 公网）；是否用蓝牙耳机（影响判定类问题的判断）
      placeholder: 例：Chrome 128 / Android Chrome；本地局域网；蓝牙耳机
    validations:
      required: true
