# Reuse assessment

Upstream: AleksNeStu/ai-real-estate-assistant at bb535cc627f30143ea48d1cf807e2f5fd75402f4, MIT.
Reused now: Button, Card and class-name merger into @noxh/ui. Imports updated; preserved disabled semantics tested; full attribution in THIRD_PARTY_NOTICES.md.
Candidate later: citation serialization, stream buffering and provider abstractions only after task-scoped privacy and contract review. No candidate is claimed imported.
Excluded from current implementation: backend credential-injecting proxy, shared demo/admin identity, global RAG collection/reset, heuristic valuation, currency-agnostic price caps and lottery/financial features. NOXH uses NestJS and citizen legal workflow boundaries; cloning the entire backend would create incompatible contracts and repeat reviewed risks.
Dependency packages retain upstream licenses. zmp-sdk is an optional proprietary-provider channel integration, not a required core backend or AI service.
