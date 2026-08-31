# Docker Compose 部署

## Goal

多阶段 Dockerfile + docker-compose + Caddy 反代（TLS/压缩/WS 超时），assets 走 bind mount 不进镜像，GitHub Actions 构建推 GHCR，VPS 侧拉取部署与 assets 同步流程。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
