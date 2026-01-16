# {{PROJECT_NAME}} Coding Standards & Best Practices

**Version:** {{VERSION}}
**Last Updated:** {{DATE}}
**Architecture:** {{ARCHITECTURE_TYPE}}

---

## Quick Start

1. Copy this file to your project root as `CLAUDE.md`
2. Replace all `{{PLACEHOLDER}}` values with your project specifics
3. Delete language/framework sections that don't apply to your stack
4. Add project-specific patterns as needed

---

## Project Configuration

<!-- Fill these values to customize this template -->

| Setting | Value | Options |
|---------|-------|---------|
| **Language** | `{{LANGUAGE}}` | TypeScript, JavaScript, Python, Go, Rust |
| **Package Manager** | `{{PACKAGE_MANAGER}}` | pnpm, bun, npm, yarn, pip, poetry, cargo, go mod |
| **Backend Framework** | `{{BACKEND_FRAMEWORK}}` | Hono, Elysia, Express, Fastify, FastAPI, Gin, Axum |
| **Frontend Framework** | `{{FRONTEND_FRAMEWORK}}` | React, Vue, Svelte, Solid, None |
| **Database/ORM** | `{{DATABASE_ORM}}` | Drizzle, Prisma, SQLAlchemy, GORM, Diesel |
| **Testing Framework** | `{{TESTING_FRAMEWORK}}` | Vitest, Jest, pytest, go test, cargo test |
| **Linter/Formatter** | `{{LINTER_FORMATTER}}` | Biome, ESLint+Prettier, Ruff, golangci-lint, rustfmt |

---

## Table of Contents

1. [Technology Selection Guidelines](#1-technology-selection-guidelines)
2. [Naming Conventions](#2-naming-conventions)
3. [Language-Specific Standards](#3-language-specific-standards)
4. [Backend Patterns](#4-backend-patterns)
5. [Frontend Patterns](#5-frontend-patterns)
6. [Database Patterns](#6-database-patterns)
7. [Testing Standards](#7-testing-standards)
8. [SOLID Principles](#8-solid-principles)
9. [Security Best Practices](#9-security-best-practices)
10. [Error Handling](#10-error-handling)
11. [Performance Guidelines](#11-performance-guidelines)
12. [Documentation Standards](#12-documentation-standards)
13. [Git Workflow](#13-git-workflow)
14. [Issue Hierarchy](#14-issue-hierarchy)
15. [AI Agent Workflow](#15-ai-agent-workflow)
16. [Claude Code Configuration](#16-claude-code-configuration)

---

## 1. Technology Selection Guidelines

### Selection Criteria

| Priority | Criteria | Description |
|----------|----------|-------------|
| 1 | **Recency** | Prefer technologies released/updated within last 3 years |
| 2 | **Active Maintenance** | Active development, regular releases, responsive maintainers |
| 3 | **Community Adoption** | Growing community, good documentation, ecosystem support |
| 4 | **Type Safety** | First-class type support (TypeScript, type hints, generics) |
| 5 | **Performance** | Modern optimizations (tree-shaking, lazy loading, async) |

### Technology Evaluation Checklist

Before adopting any new technology:

- [ ] **Release Date**: From the last 3 years?
- [ ] **Last Update**: Updated within last 6 months?
- [ ] **Community Activity**: Growing or stable community?
- [ ] **Type Support**: Native types or excellent definitions?
- [ ] **Bundle/Binary Size**: Optimized for production?
- [ ] **Breaking Changes**: Stable API with clear migration paths?

### Preferred Modern Stack by Language

#### TypeScript/JavaScript (2023-2025)

| Category | Preferred | Avoid |
|----------|-----------|-------|
| Runtime | Bun, Deno, Node 20+ | Node < 18 |
| Backend | Hono, Elysia, Fastify | Express (legacy) |
| Frontend | React 18+, Solid, Svelte 5 | React < 17 |
| Meta Framework | TanStack Start, Next 14+, Nuxt 3 | CRA, Next < 13 |
| ORM | Drizzle, Prisma 5+ | Sequelize, TypeORM |
| Validation | Zod, Valibot | Joi, Yup |
| Testing | Vitest, Playwright | Jest (prefer Vitest) |
| Build | Vite, Turbopack, Rsbuild | Webpack |
| Package Manager | pnpm, Bun | npm, Yarn Classic |

#### Python (2023-2025)

| Category | Preferred | Avoid |
|----------|-----------|-------|
| Runtime | Python 3.11+ | Python < 3.9 |
| Backend | FastAPI, Litestar | Flask, Django (for APIs) |
| Async | asyncio, HTTPX | requests (sync only) |
| ORM | SQLAlchemy 2.0, SQLModel | SQLAlchemy < 2.0 |
| Validation | Pydantic v2 | Pydantic v1 |
| Testing | pytest, pytest-asyncio | unittest |
| Linting | Ruff, mypy | flake8, pylint |
| Package Manager | uv, poetry, pdm | pip alone |

#### Go (2023-2025)

| Category | Preferred | Avoid |
|----------|-----------|-------|
| Runtime | Go 1.21+ | Go < 1.18 |
| Backend | Gin, Echo, Fiber | net/http alone |
| ORM | GORM, sqlc, Ent | raw SQL everywhere |
| Validation | go-playground/validator | manual validation |
| Testing | testify, gomock | testing alone |
| Linting | golangci-lint | golint (deprecated) |

#### Rust (2023-2025)

| Category | Preferred | Avoid |
|----------|-----------|-------|
| Runtime | Rust 1.70+ | Rust < 1.60 |
| Backend | Axum, Actix-web 4 | Rocket (older) |
| Async | Tokio | async-std |
| ORM | SeaORM, Diesel | raw SQL |
| Serialization | serde | manual parsing |
| Testing | cargo test, mockall | - |
| Linting | clippy, rustfmt | - |

---

## 2. Naming Conventions

### 2.1 Files and Directories

| Type | Convention | Example |
|------|------------|---------|
| General files | `kebab-case` | `user-service.ts`, `api_client.py` |
| Components (React/Vue) | `PascalCase` | `UserCard.tsx`, `UserCard.vue` |
| Classes | `PascalCase` | `UserService.ts`, `user_service.py` |
| Entry points | `index.*` / `main.*` | `index.ts`, `main.py`, `main.go` |
| Tests | `*.test.*` / `*_test.*` | `user.test.ts`, `user_test.go` |
| Directories | `kebab-case` | `user-management/`, `api-routes/` |

### 2.2 Variables and Functions

| Language | Variables | Constants | Functions |
|----------|-----------|-----------|-----------|
| TypeScript/JS | `camelCase` | `SCREAMING_SNAKE` | `camelCase` |
| Python | `snake_case` | `SCREAMING_SNAKE` | `snake_case` |
| Go (exported) | `PascalCase` | `PascalCase` | `PascalCase` |
| Go (unexported) | `camelCase` | `camelCase` | `camelCase` |
| Rust | `snake_case` | `SCREAMING_SNAKE` | `snake_case` |

### 2.3 Function Naming Prefixes

| Prefix | Usage | Example |
|--------|-------|---------|
| `get` | Retrieve data | `getUserById()` |
| `set` | Set/assign value | `setUserName()` |
| `fetch` | API/network call | `fetchUserData()` |
| `create` | Create new entity | `createUser()` |
| `update` | Modify existing | `updateOrder()` |
| `delete` | Remove entity | `deleteRecord()` |
| `validate` | Validation logic | `validateInput()` |
| `handle` | Event handlers | `handleSubmit()` |
| `is/has/can` | Boolean checks | `isValid()`, `hasPermission()` |
| `use` | React hooks | `useAuth()`, `useQuery()` |

### 2.4 Database Naming

| Element | Convention | Example |
|---------|------------|---------|
| Tables | `snake_case` (plural) | `users`, `order_items` |
| Columns | `snake_case` | `created_at`, `user_id` |
| Primary keys | `id` or `{table}_id` | `id`, `user_id` |
| Foreign keys | `{referenced_table}_id` | `user_id`, `order_id` |
| Indexes | `{table}_{column}_idx` | `users_email_idx` |

---

## 3. Language-Specific Standards

### 3.1 TypeScript

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmitOnError": true
  }
}
```

**Rules:**
- Always use `strict: true`
- Prefer `type` over `interface` (unless extending)
- Never use `any` - use `unknown` with type guards
- Use Zod for runtime validation

### 3.2 Python

```toml
[tool.ruff]
target-version = "py311"
line-length = 88

[tool.mypy]
strict = true
python_version = "3.11"
```

**Rules:**
- Use type hints everywhere
- Use Pydantic for data validation
- Use `async/await` for I/O operations

### 3.3 Go

**Rules:**
- Use `gofmt` / `goimports` for formatting
- Export only what's necessary (PascalCase)
- Handle errors explicitly - never ignore with `_`
- Use context for cancellation

### 3.4 Rust

**Rules:**
- Use `clippy` for linting
- Use `rustfmt` for formatting
- Prefer `Result<T, E>` over panics
- Use `?` operator for error propagation

---

## 4. Backend Patterns

### 4.1 TypeScript - Hono

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono()
  .get("/users", async (c) => {
    const users = await db.select().from(usersTable);
    return c.json(users);
  })
  .post("/users",
    zValidator("json", z.object({ name: z.string(), email: z.string().email() })),
    async (c) => {
      const data = c.req.valid("json");
      const [user] = await db.insert(usersTable).values(data).returning();
      return c.json(user, 201);
    }
  );

export type AppType = typeof app;
```

### 4.2 TypeScript - Elysia

```typescript
import { Elysia, t } from "elysia";

const app = new Elysia()
  .get("/users", async () => await db.select().from(usersTable))
  .post("/users", async ({ body }) => {
    const [user] = await db.insert(usersTable).values(body).returning();
    return user;
  }, {
    body: t.Object({ name: t.String(), email: t.String({ format: "email" }) })
  });

export type App = typeof app;
```

### 4.3 Python - FastAPI

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

app = FastAPI()

class UserCreate(BaseModel):
    name: str
    email: EmailStr

@app.get("/users")
async def get_users():
    return await db.fetch_all("SELECT * FROM users")

@app.post("/users", status_code=201)
async def create_user(data: UserCreate):
    return await db.create_user(data)
```

### 4.4 Go - Gin

```go
func main() {
    r := gin.Default()
    
    r.GET("/users", func(c *gin.Context) {
        users, err := db.GetAllUsers(c.Request.Context())
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, users)
    })
    
    r.POST("/users", func(c *gin.Context) {
        var user User
        if err := c.ShouldBindJSON(&user); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }
        created, _ := db.CreateUser(c.Request.Context(), user)
        c.JSON(http.StatusCreated, created)
    })
    
    r.Run(":8080")
}
```

### 4.5 Rust - Axum

```rust
async fn get_users(State(db): State<DbPool>) -> Json<Vec<User>> {
    let users = db.get_all_users().await.unwrap();
    Json(users)
}

async fn create_user(State(db): State<DbPool>, Json(data): Json<CreateUser>) -> (StatusCode, Json<User>) {
    let user = db.create_user(data).await.unwrap();
    (StatusCode::CREATED, Json(user))
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/users", get(get_users).post(create_user))
        .with_state(db_pool);
    
    axum::serve(listener, app).await.unwrap();
}
```

---

## 5. Frontend Patterns

### 5.1 React Component Structure

```typescript
import { useState, useCallback, useMemo } from "react";

type Props = {
  user: User;
  onUpdate: (user: User) => void;
};

function UserCard({ user, onUpdate }: Props) {
  // 1. Hooks
  const [isEditing, setIsEditing] = useState(false);
  
  // 2. Memoized values
  const displayName = useMemo(() => `${user.firstName} ${user.lastName}`, [user]);
  
  // 3. Callbacks
  const handleSave = useCallback(() => {
    onUpdate(user);
    setIsEditing(false);
  }, [user, onUpdate]);
  
  // 4. Early returns
  if (!user) return null;
  
  // 5. Render
  return <div>{displayName}</div>;
}
```

### 5.2 Data Fetching (TanStack Query)

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api.users.get(),
  });
}

function useCreateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateUser) => api.users.post(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
```

### 5.3 State Management (Zustand)

```typescript
import { create } from "zustand";

interface AppState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

### 5.4 State Management (Jotai)

```typescript
import { atom, useAtom, useAtomValue } from "jotai";

const userAtom = atom<User | null>(null);
const isLoggedInAtom = atom((get) => get(userAtom) !== null);

export function useUser() {
  return useAtom(userAtom);
}

export function useIsLoggedIn() {
  return useAtomValue(isLoggedInAtom);
}
```

---

## 6. Database Patterns

### 6.1 TypeScript - Drizzle ORM

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Queries
export async function getAllUsers(): Promise<User[]> {
  return db.select().from(users);
}

export async function createUser(data: NewUser): Promise<User> {
  const [user] = await db.insert(users).values(data).returning();
  return user;
}
```

### 6.2 Python - SQLAlchemy

```python
from sqlalchemy import Column, String, DateTime, func
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime, default=func.now())
```

### 6.3 Go - GORM

```go
type User struct {
    ID        string    `gorm:"primaryKey"`
    Name      string    `gorm:"not null"`
    Email     string    `gorm:"uniqueIndex;not null"`
    CreatedAt time.Time `gorm:"autoCreateTime"`
}

func GetAllUsers(db *gorm.DB) ([]User, error) {
    var users []User
    result := db.Find(&users)
    return users, result.Error
}
```

### 6.4 Rust - SeaORM

```rust
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    #[sea_orm(unique)]
    pub email: String,
    pub created_at: DateTime,
}
```

---

## 7. Testing Standards

### 7.1 Test-Driven Development (TDD) - MANDATORY

```
┌─────────────────────────────────────────────┐
│                TDD CYCLE                    │
│    ┌─────────┐                              │
│    │   RED   │  Write failing test          │
│    └────┬────┘                              │
│         ▼                                   │
│    ┌─────────┐                              │
│    │  GREEN  │  Write minimum code to pass  │
│    └────┬────┘                              │
│         ▼                                   │
│    ┌─────────┐                              │
│    │REFACTOR │  Improve code quality        │
│    └────┬────┘                              │
│         └──────────► Repeat                 │
└─────────────────────────────────────────────┘
```

### 7.2 Coverage Requirements

| Metric | Minimum | Target |
|--------|---------|--------|
| Statements | 80% | 90% |
| Branches | 75% | 85% |
| Functions | 80% | 90% |
| Lines | 80% | 90% |

### 7.3 Test Examples by Language

**TypeScript (Vitest):**
```typescript
import { describe, it, expect } from "vitest";

describe("UserService", () => {
  it("should create user with valid data", async () => {
    const data = { name: "John", email: "john@example.com" };
    const result = await createUser(data);
    expect(result).toMatchObject(data);
  });
});
```

**Python (pytest):**
```python
import pytest

async def test_create_user_success():
    data = {"name": "John", "email": "john@example.com"}
    result = await create_user(data)
    assert result["name"] == data["name"]
```

**Go:**
```go
func TestCreateUser(t *testing.T) {
    data := User{Name: "John", Email: "john@example.com"}
    result, err := CreateUser(db, &data)
    assert.NoError(t, err)
    assert.Equal(t, data.Name, result.Name)
}
```

**Rust:**
```rust
#[tokio::test]
async fn test_create_user_success() {
    let data = CreateUser { name: "John".into(), email: "john@example.com".into() };
    let result = create_user(&db, data).await.unwrap();
    assert_eq!(result.name, "John");
}
```

---

## 8. SOLID Principles

### 8.1 Single Responsibility (SRP)
Each module/class should have only ONE reason to change.

### 8.2 Open/Closed (OCP)
Open for extension, closed for modification.

### 8.3 Liskov Substitution (LSP)
Subtypes must be substitutable for their base types.

### 8.4 Interface Segregation (ISP)
Clients should not depend on interfaces they don't use.

### 8.5 Dependency Inversion (DIP)
Depend on abstractions, not concretions.

| Principle | Violation Sign |
|-----------|----------------|
| **SRP** | Class/function does too many things |
| **OCP** | Adding feature requires changing existing code |
| **LSP** | Subclass throws unexpected errors |
| **ISP** | Implementing unused methods |
| **DIP** | Using `new` directly in business logic |

---

## 9. Security Best Practices

### 9.1 Input Validation

**Always validate all user input:**

```typescript
// TypeScript - Zod
const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
});
```

```python
# Python - Pydantic
class UserInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
```

### 9.2 Environment Variables

```typescript
// Validate env vars at startup
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
});
const env = envSchema.parse(process.env);
```

**.gitignore:**
```
.env
.env.*
!.env.example
```

### 9.3 SQL Injection Prevention

**Always use parameterized queries:**

```typescript
// ✅ SAFE
const user = await db.select().from(users).where(eq(users.email, userInput));

// ❌ UNSAFE
const user = await db.execute(`SELECT * FROM users WHERE email = '${userInput}'`);
```

---

## 10. Error Handling

### 10.1 Backend

```typescript
// TypeScript
app.get("/users/:id", async (c) => {
  try {
    const user = await getUserById(c.req.param("id"));
    if (!user) return c.json({ error: "Not found" }, 404);
    return c.json(user);
  } catch (error) {
    console.error("Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});
```

```python
# Python
@app.get("/users/{user_id}")
async def get_user(user_id: str):
    try:
        user = await db.get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Not found")
        return user
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal error")
```

### 10.2 Frontend

```typescript
function UserProfile({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["user", id],
    queryFn: () => api.users.get(id),
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!data) return <NotFound />;

  return <UserCard user={data} />;
}
```

---

## 11. Performance Guidelines

### 11.1 Database Optimization

- Add indexes for frequently queried columns
- Avoid N+1 queries (use joins or batch loading)
- Use pagination for large datasets
- Cache frequently accessed data

### 11.2 Frontend Optimization

```typescript
// Memoize expensive computations
const processedData = useMemo(() => expensiveOperation(data), [data]);

// Memoize callbacks
const handleClick = useCallback(() => doSomething(id), [id]);

// Code splitting
const HeavyComponent = lazy(() => import("./HeavyComponent"));
```

---

## 12. Documentation Standards

### 12.1 Code Comments

```typescript
// ❌ BAD: Obvious
counter++;  // Increment counter

// ✅ GOOD: Explains why
// Use ceiling to ensure at least 1 page even for 0 items
const pageCount = Math.ceil(total / pageSize) || 1;
```

### 12.2 Function Documentation

```typescript
/**
 * Calculates total price including tax.
 * @param basePrice - Base price before tax
 * @param taxRate - Tax rate as decimal (e.g., 0.1 for 10%)
 * @returns Total price with tax
 * @throws {Error} If values are negative
 */
function calculateTotal(basePrice: number, taxRate: number): number {
  // ...
}
```

---

## 13. Git Workflow

### 13.1 Branch Strategy

**MANDATORY: Create feature branch before implementing ANY issue.**

```bash
git checkout develop && git pull
git checkout -b feature/issue-{number}-{description}
# ... implement ...
git commit -m "feat(scope): description"
git push origin feature/issue-{number}-{description}
gh pr create --base develop
```

### 13.2 Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/issue-{n}-{desc}` | `feature/issue-123-user-auth` |
| Bug fix | `fix/issue-{n}-{desc}` | `fix/issue-456-login-error` |
| Hotfix | `hotfix/{desc}` | `hotfix/security-patch` |
| Epic | `feature/epic-{n}-{name}` | `feature/epic-1-user-management` |

### 13.3 Protected Branches

| Branch | Direct Commits | Status |
|--------|----------------|--------|
| `main` | **NEVER** | Production |
| `develop` | **NEVER** | Integration |
| `feature/*` | YES | Working branch |

### 13.4 Commit Messages (Conventional Commits)

```bash
<type>(<scope>): <subject>

# Types: feat, fix, refactor, chore, docs, test, perf
# Examples:
git commit -m "feat(auth): add JWT refresh token"
git commit -m "fix(api): handle null response"
```

### 13.5 Pre-Commit Quality Gates

```bash
{{PACKAGE_MANAGER}} typecheck   # Type checking
{{PACKAGE_MANAGER}} lint        # Linting
{{PACKAGE_MANAGER}} test        # Tests
{{PACKAGE_MANAGER}} build       # Build verification
```

---

## 14. Issue Hierarchy

### 14.1 Structure

| Level | Entity | Purpose |
|-------|--------|---------|
| Epic | Parent Issue | Groups related work |
| Task | Sub-Issue | Individual unit of work |
| Milestone | Milestone | Delivery target |

### 14.2 Epic Template

```markdown
## [EPIC] {{Name}}: {{Description}}

### Overview
Brief description.

### Sub-Issues
- [ ] #123 - Task 1
- [ ] #124 - Task 2

### Acceptance Criteria
- [ ] Criterion 1
```

### 14.3 Sub-Issue Template

```markdown
## Parent
Part of #{{epic-number}}

## Description
Task details.

## Acceptance Criteria
- [ ] Criterion 1
```

---

## 15. AI Agent Workflow

### 15.1 Pre-Implementation: Codebase Exploration (MANDATORY)

**Before ANY implementation work begins, agents MUST explore and understand the codebase.**

#### Exploration Checklist

| Step | Action | Purpose |
|------|--------|---------|
| 1 | Read `.claude/docs/` | Understand project-specific patterns and archived decisions |
| 2 | Read `.claude/plans/` | Review existing plans and architectural decisions |
| 3 | Read `.claude/tech-stack.md` | Understand technology choices and constraints |
| 4 | Read `CLAUDE.md` | Understand coding standards and conventions |
| 5 | Explore relevant source files | Understand existing patterns and code structure |
| 6 | Identify dependencies | Map out what the feature will interact with |

#### Exploration Process

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 0: CODEBASE EXPLORATION (Before Implementation)      │
│                                                             │
│  1. Read project documentation                              │
│     - .claude/docs/*                                        │
│     - .claude/plans/*                                       │
│     - .claude/tech-stack.md                                 │
│     - CLAUDE.md                                             │
│                                                             │
│  2. Explore existing codebase                               │
│     - Identify similar features/patterns                    │
│     - Understand project structure                          │
│     - Map dependencies and integrations                     │
│                                                             │
│  3. Document understanding                                  │
│     - Note relevant patterns to follow                      │
│     - Identify potential impacts                            │
│     - List questions/clarifications needed                  │
│                                                             │
│  Only proceed to implementation after exploration complete  │
└─────────────────────────────────────────────────────────────┘
```

#### What to Look For

| Area | Questions to Answer |
|------|---------------------|
| **Architecture** | How is the project structured? What patterns are used? |
| **Similar Features** | Are there similar features to reference? |
| **Dependencies** | What modules/packages will this touch? |
| **Testing Patterns** | How are similar features tested? |
| **Conventions** | What naming/coding conventions are enforced? |
| **Constraints** | Are there tech stack constraints to follow? |

**WARNING: Starting implementation without exploration leads to:**
- Code that doesn't follow project patterns
- Duplicated functionality
- Integration issues
- Wasted review cycles

### 15.2 Task Planning: Breaking Down Milestones (MANDATORY)

**When creating issues/tasks for a milestone, tasks MUST be as small as possible.**

#### Task Sizing Rules

| Rule | Description |
|------|-------------|
| **Single Responsibility** | Each task does ONE thing only |
| **Atomic Changes** | Task can be completed in a single PR |
| **Clear Scope** | No ambiguity about what's included/excluded |
| **Testable** | Task has clear acceptance criteria |
| **Time-Bounded** | Ideally completable in 1-4 hours |

#### Task Breakdown Guidelines

```
┌─────────────────────────────────────────────────────────────┐
│  BAD: Large, vague tasks                                    │
│  ❌ "Implement user authentication"                         │
│  ❌ "Add API endpoints"                                     │
│  ❌ "Create dashboard page"                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  GOOD: Small, specific tasks                                │
│  ✅ "Add login form component"                              │
│  ✅ "Create /api/auth/login endpoint"                       │
│  ✅ "Add password validation schema"                        │
│  ✅ "Write unit tests for auth service"                     │
│  ✅ "Add session token storage"                             │
└─────────────────────────────────────────────────────────────┘
```

#### Benefits of Small Tasks

| Benefit | Description |
|---------|-------------|
| **Easier Review** | Small PRs are reviewed faster and more thoroughly |
| **Lower Risk** | Less code = fewer bugs, easier rollback |
| **Better Tracking** | Clear progress visibility on milestone |
| **Parallel Work** | Multiple agents can work simultaneously |
| **Faster Feedback** | Issues caught early in small increments |

#### Task Checklist Before Creating Issue

- [ ] Can this be broken down further?
- [ ] Is the scope crystal clear?
- [ ] Can it be completed in one PR?
- [ ] Are acceptance criteria specific and testable?
- [ ] Does it have a single, clear outcome?

**Rule of Thumb:** If a task description needs "and" or multiple bullet points, it should be split into separate issues.

#### Task Priority Order (MANDATORY)

**Security alerts (Dependabot, Snyk, etc.) with Critical/High severity MUST be addressed FIRST.**

| Priority | Type | Action |
|----------|------|--------|
| **P0 - CRITICAL** | Critical/High security alerts | Drop everything, fix immediately |
| **P1 - HIGH** | Medium security alerts, Production bugs | Fix within 24 hours |
| **P2 - NORMAL** | Feature work, Enhancements | Normal sprint/milestone work |
| **P3 - LOW** | Tech debt, Minor improvements | When time permits |

```
┌─────────────────────────────────────────────────────────────┐
│  SECURITY ALERT WORKFLOW                                    │
│                                                             │
│  1. Security alert detected (Dependabot/Snyk/etc.)          │
│     ↓                                                       │
│  2. Assess severity (Critical/High/Medium/Low)              │
│     ↓                                                       │
│  3. Critical/High? → STOP current work                      │
│     ↓                                                       │
│  4. Create hotfix branch immediately                        │
│     ↓                                                       │
│  5. Fix vulnerability                                       │
│     ↓                                                       │
│  6. Expedited review (can reduce to 1-2 reviews)            │
│     ↓                                                       │
│  7. Merge and deploy ASAP                                   │
└─────────────────────────────────────────────────────────────┘
```

**Security Alert Sources:**
- Dependabot (GitHub)
- Snyk
- GitLab Security Scanner
- npm audit / pnpm audit
- OWASP Dependency Check
- Custom security scanning tools

**WARNING:** Ignoring Critical/High security alerts is NEVER acceptable. These vulnerabilities can lead to:
- Data breaches
- System compromise
- Compliance violations
- Reputation damage

#### Quality Gates: NEVER Skip (MANDATORY)

**Quality gates MUST pass before ANY commit, regardless of task type.**

```
┌─────────────────────────────────────────────────────────────┐
│  QUALITY GATES - NEVER SKIP OR BYPASS                       │
│                                                             │
│  ✗ "It's just a docs change" → Still run quality gates      │
│  ✗ "It's not related to my code" → Still run quality gates  │
│  ✗ "I'll fix it later" → Fix NOW before commit              │
│  ✗ "Using --no-verify" → PROHIBITED                         │
│                                                             │
│  Every commit MUST pass:                                    │
│  1. Type checking (typecheck)                               │
│  2. Linting (lint)                                          │
│  3. Tests (test)                                            │
│  4. Build (build)                                           │
└─────────────────────────────────────────────────────────────┘
```

| Excuse | Response |
|--------|----------|
| "My change doesn't affect types" | Run typecheck anyway - you may have broken something |
| "Tests are unrelated to my work" | Run tests anyway - integration issues happen |
| "Pre-commit hooks are slow" | Wait for them - they exist for a reason |
| "I need to push urgently" | Quality is never urgent enough to skip |

**If quality gates fail:**
1. **STOP** - Do not bypass with `--no-verify` or `--skip-ci`
2. **FIX** - Address the failure, even if it's in "unrelated" code
3. **VERIFY** - Run quality gates again until they pass
4. **COMMIT** - Only then proceed with the commit

**The codebase health is everyone's responsibility. A "small" documentation change that bypasses a failing typecheck still ships broken code.**

### 15.3 Implementation Process

| Step | Agent | Action |
|------|-------|--------|
| 0 | All Agents | **Explore and understand codebase** (MANDATORY) |
| 1 | - | Create feature branch |
| 2 | QA Agent | Create test suite |
| 3 | Fullstack Agent | Implement feature (following explored patterns) |
| 4 | - | Run quality gates |
| 5 | - | Commit and create PR |
| 6 | Principal Agent | Review #1: Initial review |
| 7 | Fullstack Agent | Address feedback |
| 8 | Principal Agent | Review #2: Verification |
| 9 | Fullstack Agent | Address feedback |
| 10 | Principal Agent | Review #3: Final approval |

### 15.4 Minimum Review Requirements

**Each PR MUST receive at least 3 reviews before merge:**

| Review | Focus |
|--------|-------|
| Review #1 | Critical issues, architecture, security |
| Review #2 | Verify fixes, deeper analysis, edge cases |
| Review #3 | Final verification, merge decision |

### 15.5 Team Agent Roles

| Agent | Exploration Focus | Implementation Focus |
|-------|-------------------|----------------------|
| Principal Agent | Architecture patterns, security concerns | Code quality, security review |
| QA Agent | Testing patterns, existing test coverage | Test suite creation, regression |
| Fullstack Agent | Code structure, existing implementations | Feature implementation |
| UI/UX Agent | Design patterns, component library | User experience, accessibility |
| Solution Architect | System design, integrations | Scalability, architecture review |

**All agents participate in Phase 0 exploration based on their domain expertise.**

### 15.6 Workflow Diagram

```
┌─────────────────────────────────────────────┐
│  0. EXPLORE CODEBASE (MANDATORY)            │
│     - Read .claude/docs/, plans/, tech-stack│
│     - Explore existing patterns             │
│     - Map dependencies                      │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  1. CREATE FEATURE BRANCH                   │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  2. QA AGENT: CREATE TEST SUITE             │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  3. FULLSTACK AGENT: IMPLEMENT FEATURE      │
│     (following explored patterns)           │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  4. RUN QUALITY GATES                       │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  5. COMMIT AND CREATE PR                    │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  6-10. REVIEW CYCLES (3 minimum)            │
└─────────────────────────────────────────────┘
```

### 15.7 Epic Branch Strategy

```
┌─────────────────────────────────────────────┐
│  1. CREATE EPIC BRANCH                      │
│     feature/epic-{n}-{name}                 │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  2. CREATE FEATURE BRANCHES FROM EPIC       │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  3. MERGE FEATURES TO EPIC (not develop)    │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  4. TEST ON EPIC BRANCH                     │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  5. MERGE EPIC TO DEVELOP                   │
└─────────────────────────────────────────────┘
```

---

## 16. Claude Code Configuration

### 16.1 File Location Rules

**All Claude Code files MUST be in project root:**

```
{{PROJECT_ROOT}}/.claude/
├── plans/                  # Implementation plans
├── docs/                   # Project documentation
├── agents/                 # Agent configurations
├── tasks/                  # Task tracking
├── settings.json           # Project settings
└── commands/               # Custom slash commands
```

| Location | Status |
|----------|--------|
| `{{PROJECT_ROOT}}/.claude/` | **REQUIRED** |
| `~/.claude/` (user home) | **PROHIBITED** |

---

## Summary Checklist

### Before Committing

- [ ] All quality gates pass (typecheck, lint, test, build)
- [ ] No hardcoded secrets
- [ ] Error handling in place
- [ ] Tests cover new functionality

### Code Review Checklist

- [ ] Follows naming conventions
- [ ] Input validation present
- [ ] Error handling implemented
- [ ] No type safety violations
- [ ] Database queries optimized
- [ ] Security best practices followed
- [ ] Documentation updated if needed

---

**End of Document**

*This template provides universal coding standards. Replace `{{PLACEHOLDERS}}` and remove sections that don't apply to your stack.*
