"""Pydantic models shared by the framework stage."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class ArticleStatus(StrEnum):
    PROCESSING = "PROCESSING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    APPROVED = "APPROVED"
    PUBLISHED = "PUBLISHED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"
    ARCHIVED = "ARCHIVED"


class ContentType(StrEnum):
    GENERAL_NEWS = "GENERAL_NEWS"
    PROBLEM_FOCUSED = "PROBLEM_FOCUSED"
    TRANSFORMATION = "TRANSFORMATION"
    PERSUASIVE = "PERSUASIVE"
    PRODUCT_LAUNCH = "PRODUCT_LAUNCH"
    BRAND_STORY = "BRAND_STORY"
    LONG_FORM = "LONG_FORM"


class SourceArticle(BaseModel):
    url_hash: str
    source_url: str
    domain: str
    niche: str | None = None
    original_title: str | None = None
    original_author: str | None = None
    published_at: str | None = None
    original_content: str
    genz_title: str | None = None
    hook: str | None = None
    tldr: list[str] = Field(default_factory=list)
    source_attribution: str | None = None


class Claim(BaseModel):
    text: str
    source_quote: str


class GeneratedArticle(BaseModel):
    title: str
    slug: str
    summary: str
    body_md: str
    framework: str
    content_type: str
    category: str
    tags: list[str] = Field(default_factory=list)
    seo_title: str
    seo_description: str
    keywords: list[str] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)


class ValidationResult(BaseModel):
    passed: bool
    hard_fail: bool
    confidence: float
    fact_risk: Literal["LOW", "MEDIUM", "HIGH"]
    flags: list[str] = Field(default_factory=list)


class Fingerprint(BaseModel):
    content_hash: str
    norm_title: str
    simhash: int


class KnownArticle(BaseModel):
    url_hash: str
    cluster_id: str
    fingerprint: Fingerprint


class SiteArticleRecord(BaseModel):
    """One row of the Supabase `site_articles` table."""

    id: str | None = None
    url_hash: str
    content_hash: str | None = None
    norm_title: str | None = None
    simhash: str | None = None  # hex text
    slug: str | None = None
    title: str | None = None
    summary: str | None = None
    body_md: str | None = None
    generated_body_md: str | None = None
    framework: str | None = None
    content_type: str | None = None
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    seo_title: str | None = None
    seo_description: str | None = None
    keywords: list[str] = Field(default_factory=list)
    source_url: str | None = None
    source_domain: str | None = None
    source_name: str | None = None
    also_reported_by: list[dict[str, str]] = Field(default_factory=list)
    image_url: str | None = None
    image_source: str | None = None
    cluster_id: str | None = None
    confidence: float | None = None
    fact_risk: str | None = None
    flags: list[str] = Field(default_factory=list)
    status: ArticleStatus = ArticleStatus.PROCESSING
    regen_framework: str | None = None
    byline: str = "GenZNews Desk"
    ai_disclosure: bool = False
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    published_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    job_id: str | None = None


class JobRecord(BaseModel):
    job_id: str  # must be a UUID string (Task 11 generates str(uuid.uuid4()))
    url_hash: str
    started_at: str
    finished_at: str | None = None
    duration_ms: int | None = None
    stages: dict[str, str] = Field(default_factory=dict)
    error: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    est_cost_usd: float = 0.0
