# Warehouse and Location Model

**Implemented with service validation and migration trigger; database verification pending.**

Hierarchy: Warehouse → Rack → Shelf → Bin. Warehouse and Bin can bear stock; Rack and Shelf are organizational. Every descendant records company and warehouse identity. Composite parent keys and a PostgreSQL trigger enforce company/warehouse ownership and parent type.

Location codes are unique within a warehouse. Stock posting locks the warehouse location mode and blocks non-zero direct Warehouse balances when Bin balances exist, and vice versa. Historical ledger rows retain their original location foreign key. A historical relocation workflow and location deactivation endpoint are deferred; do not move or delete locations referenced by stock history.
