from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.dialects import sqlite
from sqlalchemy.engine import Engine

from .database import Base

# Safety valve: an explicit SQL literal default for a NOT NULL column this generic
# migration cannot derive automatically (no plain scalar Column default -- e.g. a
# server_default or a callable default). Keyed by (table_name, column_name). Prefer
# fixing the model to use a plain scalar `default=` over adding entries here.
_EXPLICIT_DEFAULTS: dict[tuple[str, str], str] = {}


def apply_schema_migrations(engine: Engine) -> list[str]:
    """Idempotent schema upgrade for a pre-existing database (Milestone 1 -> 1A and
    beyond).

    ``Base.metadata.create_all()`` only creates tables that don't exist yet -- it
    never alters an existing table, so a column added to an ORM model after a
    database was already created is silently missing until this runs. This adds any
    column present in the current models but absent from the live database, using a
    safe literal default for NOT NULL columns so every existing row stays valid.

    Safe to call on every app startup and safe to call more than once: a column or
    table that already exists is always left untouched. New tables are not handled
    here -- ``Base.metadata.create_all()`` (called immediately before this) already
    creates any table that doesn't exist at all.
    """

    applied: list[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.tables.values():
            if table.name not in existing_tables:
                continue  # brand-new table: create_all() already created it whole
            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                ddl = _add_column_ddl(table.name, column)
                conn.execute(text(ddl))
                applied.append(f"{table.name}.{column.name}")
    return applied


def _add_column_ddl(table_name: str, column) -> str:
    col_type = column.type.compile(dialect=sqlite.dialect())
    clause = f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {col_type}'
    if not column.nullable:
        clause += f" NOT NULL DEFAULT {_literal_default_sql(table_name, column)}"
    return clause


def _literal_default_sql(table_name: str, column) -> str:
    explicit = _EXPLICIT_DEFAULTS.get((table_name, column.name))
    if explicit is not None:
        return explicit

    default = column.default
    if default is not None and getattr(default, "is_scalar", False):
        return _python_value_to_sql_literal(default.arg)

    raise RuntimeError(
        f"migration cannot derive a NOT NULL default for {table_name}.{column.name}: "
        "add a plain scalar `default=` to the model, or add an explicit entry to "
        "app_api.migrations._EXPLICIT_DEFAULTS"
    )


def _python_value_to_sql_literal(value) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"unsupported default literal type for schema migration: {type(value)!r}")
