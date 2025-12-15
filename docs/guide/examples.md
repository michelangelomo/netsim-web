```markdown
# Example Topologies

NetSimWeb includes pre-built network topologies to help you learn networking concepts.

## Loading Examples

1. Click **File** → **Open Topology**
2. Navigate to the `examples/` directory
3. Select any `.json` file
4. The topology loads on the canvas

!!! tip "Drag and Drop"
    You can also drag and drop JSON topology files directly onto the canvas.

## Available Examples

### Simple Two PCs
**File:** `simple-two-pcs.json`  
**Difficulty:** Beginner

Two PCs connected through a switch. Perfect for learning basic ping and ARP.

```
[PC1] ----[Switch]---- [PC2]
```

**Try:** Ping from PC1 to PC2 and observe ARP resolution.

---

### VLAN Segmentation
**File:** `vlan-segmentation.json`  
**Difficulty:** Intermediate

Network with VLAN 10 (Sales) and VLAN 20 (Engineering) on one switch.

```
[Sales-PC1]  ---+            +--- [Eng-PC1]
  VLAN 10      |            |     VLAN 20
               +--[Switch]--+
  VLAN 10      |            |     VLAN 20
[Sales-PC2]  ---+            +--- [Eng-PC2]
```

**Try:** Ping within VLANs (works) vs between VLANs (blocked).

---

### Inter-VLAN Routing
**File:** `inter-vlan-routing.json`  
**Difficulty:** Intermediate

Layer 3 switch with SVIs enabling inter-VLAN routing.

```
         SVI 10: 10.10.10.1
         SVI 20: 10.20.20.1
              |
         [L3 Switch]
        /           \
    VLAN 10      VLAN 20
      |            |
[VLAN10-PCs]  [VLAN20-PCs]
```

**Try:** Ping between VLANs - traffic routes through the SVIs.

---

### Trunk Links
**File:** `trunk-links.json`  
**Difficulty:** Intermediate

Two switches connected via 802.1Q trunk, VLANs spanning both.

```
[VLAN10-PC] --[SW1]===TRUNK===[SW2]-- [VLAN10-PC]
[VLAN20-PC] --+                  +-- [VLAN20-PC]
```

**Try:** Ping between same-VLAN PCs on different switches.

---

### Multi-Router Network
**File:** `multi-router-network.json`  
**Difficulty:** Advanced

Enterprise network with core router, two branches, and data center.

```
              [Core-Router]
             /      |      \
       [Branch1]  [DC]  [Branch2]
          |       / \       |
       [SW]    [Web][DB]  [SW]
       / \               / \
    [PC1][PC2]        [PC1][PC2]
```

**Try:** Ping from Branch1-PC to Web-Server (multi-hop routing).

---

### DHCP Server
**File:** `dhcp-server.json`  
**Difficulty:** Beginner

Router as DHCP server with client PCs.

```
    [DHCP-Router]
         |
      [Switch]
     /   |   \
  [PC1][PC2][PC3]
  DHCP  DHCP Static
```

**Try:** Request DHCP on clients to get IP addresses from the pool.

---

## Creating Your Own

1. Build your network in the simulator
2. Click **File** → **Save Topology**
3. Save as `.json` file

## JSON Structure

Topology files contain:

```json
{
  "name": "My Network",
  "description": "Description here",
  "devices": [...],
  "connections": [...]
}
```

See `examples/README.md` for complete JSON structure reference.

```
