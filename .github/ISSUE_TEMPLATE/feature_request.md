---
name: 💡 玩法 / 功能提案
description: 新玩法、新规则、体验改进
labels: ["enhancement"]
---
body:
  - type: textarea
    id: motivation
    attributes:
      label: 动机
      description: 它解决什么问题，或带来什么新体验？「别的猜歌游戏有」不是充分理由，说说你自己在什么场景下会想要它
    validations:
      required: true
  - type: textarea
    id: behavior
    attributes:
      label: 预期行为
      description: 具体怎么运作：玩家看到什么、系统怎么判定、和其他玩法怎么交互
    validations:
      required: true
  - type: textarea
    id: constraints
    attributes:
      label: 与现有设计的关系
      description: 可选。玩法类改动请先读 README 的「核心设计约束」（曲库保密 / 反应时间判定）和 PRODUCT.md 的玩法定位；如果你的提案和它们冲突，说说你的权衡
  - type: dropdown
    id: implementation
    attributes:
      label: 你愿意自己实现吗
      options:
        - 只是提案
        - 愿意自己提 PR（实现前会先在这里对齐方案）
