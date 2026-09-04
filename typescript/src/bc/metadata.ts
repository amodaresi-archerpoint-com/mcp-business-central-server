import type { BCClient } from "./client.js";
import type { Config } from "../config.js";

export interface EntityField {
  name: string;
  type: string;
  nullable: boolean;
  isKey: boolean;
}

export interface EntitySchema {
  name: string;
  entitySetName: string;
  fields: EntityField[];
  navigationProperties: string[];
  /** Bound actions on this entity, e.g. ["Microsoft.NAV.shipAndInvoice"]. */
  boundActions: string[];
}

interface CachedMetadata {
  entitySetToType: Map<string, string>; // "salesOrders" -> "Microsoft.NAV.salesOrder"
  entityTypes: Map<string, EntitySchema>; // by entity set name
  fetchedAt: number;
  raw: string;
}

/**
 * The $metadata document is XML. We do a lightweight regex parse — not a
 * full XSD parser, but sufficient for surfacing field names and bound
 * actions to tool callers. For deeper schema work, callers can fetch the
 * raw XML via bc_get_raw_metadata.
 */
export class MetadataCache {
  private cache: CachedMetadata | null = null;
  private inFlight: Promise<CachedMetadata> | null = null;

  constructor(
    private readonly client: BCClient,
    private readonly config: Config,
  ) {}

  async getRaw(): Promise<string> {
    return (await this.load()).raw;
  }

  async getEntitySchema(entitySetName: string): Promise<EntitySchema | null> {
    const cached = await this.load();
    return cached.entityTypes.get(entitySetName) ?? null;
  }

  async listEntitySets(): Promise<string[]> {
    const cached = await this.load();
    return Array.from(cached.entitySetToType.keys()).sort();
  }

  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<CachedMetadata> {
    const ttlMs = this.config.metadataCacheTtlSec * 1000;
    if (
      this.cache &&
      (ttlMs === 0 || Date.now() - this.cache.fetchedAt < ttlMs)
    ) {
      return this.cache;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchAndParse().finally(() => {
      this.inFlight = null;
    });
    this.cache = await this.inFlight;
    return this.cache;
  }

  private async fetchAndParse(): Promise<CachedMetadata> {
    const raw = await this.client.fetchMetadata();
    return parseMetadata(raw);
  }
}

/**
 * Lightweight regex-based parser. Good enough for BC's predictable $metadata
 * shape. Returns: entity set name -> EntitySchema.
 */
export function parseMetadata(xml: string): CachedMetadata {
  const entitySetToType = new Map<string, string>();
  const entityTypes = new Map<string, EntitySchema>();

  // EntitySet name="customers" EntityType="Microsoft.NAV.customer"
  const entitySetRe =
    /<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"/g;
  // Map entity type FQN -> entity set name (for reverse lookup)
  const typeFqnToSetName = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = entitySetRe.exec(xml))) {
    const setName = m[1]!;
    const typeFqn = m[2]!;
    entitySetToType.set(setName, typeFqn);
    typeFqnToSetName.set(typeFqn, setName);
  }

  // Parse each <EntityType Name="customer"> ... </EntityType> block.
  const entityTypeBlockRe =
    /<EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g;
  while ((m = entityTypeBlockRe.exec(xml))) {
    const typeName = m[1]!;
    const body = m[2]!;

    // Find FQN by scanning typeFqnToSetName for matching last segment.
    let setName: string | undefined;
    for (const [fqn, sn] of typeFqnToSetName) {
      if (fqn.endsWith(`.${typeName}`)) {
        setName = sn;
        break;
      }
    }
    if (!setName) continue;

    const keys = new Set<string>();
    const keyRe = /<Key>([\s\S]*?)<\/Key>/;
    const keyMatch = keyRe.exec(body);
    if (keyMatch) {
      const propRefRe = /<PropertyRef\s+Name="([^"]+)"/g;
      let km: RegExpExecArray | null;
      while ((km = propRefRe.exec(keyMatch[1]!))) {
        keys.add(km[1]!);
      }
    }

    const fields: EntityField[] = [];
    const propRe =
      /<Property\s+Name="([^"]+)"\s+Type="([^"]+)"(?:\s+Nullable="([^"]+)")?/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(body))) {
      const name = pm[1]!;
      const type = pm[2]!;
      const nullable = pm[3] !== "false";
      fields.push({
        name,
        type,
        nullable,
        isKey: keys.has(name),
      });
    }

    const navRe = /<NavigationProperty\s+Name="([^"]+)"/g;
    const navigationProperties: string[] = [];
    let nm: RegExpExecArray | null;
    while ((nm = navRe.exec(body))) {
      navigationProperties.push(nm[1]!);
    }

    entityTypes.set(setName, {
      name: typeName,
      entitySetName: setName,
      fields,
      navigationProperties,
      boundActions: [], // populated below
    });
  }

  // Bound actions: <Action Name="..." IsBound="true">
  //   <Parameter Name="bindingParameter" Type="Microsoft.NAV.salesOrder"/>
  // ...</Action>
  const actionRe =
    /<Action\s+Name="([^"]+)"(?:\s+IsBound="true")[^>]*>([\s\S]*?)<\/Action>/g;
  while ((m = actionRe.exec(xml))) {
    const actionName = m[1]!;
    const actionBody = m[2]!;
    // First parameter is the binding parameter — its Type is the entity it binds to.
    const bindingTypeMatch =
      /<Parameter\s+Name="bindingParameter"\s+Type="([^"]+)"/.exec(actionBody);
    if (!bindingTypeMatch) continue;
    let bindingType = bindingTypeMatch[1]!;
    // Strip Collection() wrapper.
    bindingType = bindingType.replace(/^Collection\(([^)]+)\)$/, "$1");
    const setName = typeFqnToSetName.get(bindingType);
    if (!setName) continue;
    const schema = entityTypes.get(setName);
    if (schema) {
      // BC's bound-action invocation segment is the action name (sometimes
      // namespaced as Microsoft.NAV.{name}; we expose both forms in the tool).
      schema.boundActions.push(actionName);
    }
  }

  return {
    entitySetToType,
    entityTypes,
    fetchedAt: Date.now(),
    raw: xml,
  };
}
