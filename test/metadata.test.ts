import { describe, expect, it } from "vitest";
import { parseMetadata } from "../src/bc/metadata.js";

const SAMPLE_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Microsoft.NAV">
      <EntityType Name="customer">
        <Key>
          <PropertyRef Name="id"/>
        </Key>
        <Property Name="id" Type="Edm.Guid" Nullable="false"/>
        <Property Name="number" Type="Edm.String"/>
        <Property Name="displayName" Type="Edm.String"/>
        <Property Name="balance" Type="Edm.Decimal" Nullable="true"/>
        <NavigationProperty Name="salesOrders" Type="Collection(Microsoft.NAV.salesOrder)"/>
      </EntityType>
      <EntityType Name="salesOrder">
        <Key>
          <PropertyRef Name="id"/>
        </Key>
        <Property Name="id" Type="Edm.Guid" Nullable="false"/>
        <Property Name="number" Type="Edm.String"/>
      </EntityType>
      <Action Name="shipAndInvoice" IsBound="true">
        <Parameter Name="bindingParameter" Type="Microsoft.NAV.salesOrder"/>
      </Action>
      <EntityContainer Name="NAV">
        <EntitySet Name="customers" EntityType="Microsoft.NAV.customer"/>
        <EntitySet Name="salesOrders" EntityType="Microsoft.NAV.salesOrder"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

describe("parseMetadata", () => {
  const parsed = parseMetadata(SAMPLE_METADATA);

  it("discovers all entity sets", () => {
    expect(parsed.entitySetToType.size).toBe(2);
    expect(parsed.entitySetToType.get("customers")).toBe(
      "Microsoft.NAV.customer",
    );
    expect(parsed.entitySetToType.get("salesOrders")).toBe(
      "Microsoft.NAV.salesOrder",
    );
  });

  it("parses fields with types and nullability", () => {
    const customer = parsed.entityTypes.get("customers");
    expect(customer).toBeDefined();
    const id = customer!.fields.find((f) => f.name === "id");
    expect(id).toEqual({
      name: "id",
      type: "Edm.Guid",
      nullable: false,
      isKey: true,
    });
    const balance = customer!.fields.find((f) => f.name === "balance");
    expect(balance?.nullable).toBe(true);
    expect(balance?.isKey).toBe(false);
  });

  it("captures navigation properties", () => {
    const customer = parsed.entityTypes.get("customers");
    expect(customer?.navigationProperties).toContain("salesOrders");
  });

  it("attaches bound actions to their target entity set", () => {
    const so = parsed.entityTypes.get("salesOrders");
    expect(so?.boundActions).toContain("shipAndInvoice");
    const customer = parsed.entityTypes.get("customers");
    expect(customer?.boundActions).not.toContain("shipAndInvoice");
  });
});
