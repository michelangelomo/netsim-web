# VLAN Implementation - Phases 4-6

## Overview

Phases 1-3 established the VLAN data model, store functions, and terminal commands. Phases 4-6 implement the actual packet processing logic for VLAN-aware forwarding.

---

## Phase 4: VLAN-Aware Switch Forwarding

### Objective
Update switch forwarding logic to respect VLAN boundaries. Frames should only be forwarded within the same VLAN.

### Implementation Details

#### 4.1 Access Port Ingress Processing
When a frame arrives on an **access port**:
1. Tag the frame with the port's `accessVlan` (internal tagging)
2. Learn the source MAC with the VLAN ID in the MAC table
3. Forward based on VLAN-aware lookup

```typescript
// Pseudo-code
function processAccessPortIngress(frame: Packet, port: NetworkInterface): Packet {
  // Tag frame with access VLAN
  frame.vlanTag = port.accessVlan ?? 1;
  
  // Learn MAC with VLAN
  learnMac(frame.sourceMAC, port.name, frame.vlanTag);
  
  return frame;
}
```

#### 4.2 Access Port Egress Processing
When sending a frame out an **access port**:
1. Frame must belong to the port's access VLAN (or be dropped)
2. Remove VLAN tag before sending (access ports don't send tagged frames)

```typescript
function processAccessPortEgress(frame: Packet, port: NetworkInterface): Packet | null {
  // Only forward if VLAN matches
  if (frame.vlanTag !== port.accessVlan) {
    return null; // Drop - VLAN mismatch
  }
  
  // Remove tag for access port
  delete frame.vlanTag;
  return frame;
}
```

#### 4.3 VLAN-Aware MAC Table Lookup
Update MAC table lookup to consider VLAN:

```typescript
function lookupMac(mac: string, vlanId: number): string | null {
  const entry = macTable.find(e => 
    e.macAddress === mac && e.vlan === vlanId
  );
  return entry?.port ?? null;
}
```

#### 4.4 VLAN-Aware Flooding
When flooding (broadcast or unknown unicast):
- Only flood to ports in the same VLAN
- Access ports: only if `accessVlan` matches
- Trunk ports: only if VLAN is in `allowedVlans`

### Tests for Phase 4

```typescript
describe('Phase 4: VLAN-Aware Switch Forwarding', () => {
  describe('Access Port Processing', () => {
    it('should tag frame with access VLAN on ingress');
    it('should learn MAC with VLAN information');
    it('should forward frame only to ports in same VLAN');
    it('should drop frame if destination port is in different VLAN');
    it('should remove VLAN tag on access port egress');
  });

  describe('VLAN-Aware Flooding', () => {
    it('should flood broadcast only to ports in same VLAN');
    it('should flood unknown unicast only to ports in same VLAN');
    it('should not flood to access ports in different VLAN');
  });

  describe('MAC Table VLAN Isolation', () => {
    it('should maintain separate MAC entries per VLAN');
    it('should not forward based on MAC learned in different VLAN');
  });
});
```

---

## Phase 5: Inter-VLAN Routing via SVI

### Objective
Enable routing between VLANs using Switch Virtual Interfaces (SVIs). This is also known as "Router on a Stick" when using an external router, but here we implement Layer 3 switching.

### Implementation Details

#### 5.1 SVI as Routing Interface
SVIs act as the default gateway for hosts in a VLAN:
- Each SVI has an IP address in its VLAN's subnet
- Packets destined to the SVI IP are processed by the switch's L3 engine
- The switch can route between VLANs using its routing table

```typescript
interface SVIInterface {
  vlanId: number;
  ipAddress?: string;
  subnetMask?: string;
  isUp: boolean;
  macAddress: string; // Virtual MAC for the SVI
}
```

#### 5.2 Packet Flow for Inter-VLAN Routing
1. Host in VLAN 10 (192.168.10.0/24) sends packet to host in VLAN 20 (192.168.20.0/24)
2. Host ARPs for gateway (SVI 10's IP: 192.168.10.1)
3. Switch responds with SVI 10's MAC
4. Host sends packet to SVI MAC
5. Switch receives packet on access port, tags with VLAN 10
6. Switch sees destination MAC is its SVI MAC → L3 processing
7. Switch looks up destination IP in routing table
8. Switch finds VLAN 20's SVI as the outbound interface
9. Switch ARPs for destination host in VLAN 20
10. Switch forwards packet out access port in VLAN 20

#### 5.3 Routing Table for SVIs
When an SVI is configured with an IP:
- Add a connected route for that subnet
- Route type: "connected"
- Interface: "Vlan{id}" (e.g., "Vlan10")

```typescript
function configureSviIP(deviceId: string, vlanId: number, ip: string, mask: string) {
  // Update SVI
  updateSvi(deviceId, vlanId, { ipAddress: ip, subnetMask: mask });
  
  // Add connected route
  addRoute(deviceId, {
    destination: getNetworkAddress(ip, mask),
    mask: mask,
    nextHop: null,
    interface: `Vlan${vlanId}`,
    type: 'connected',
    metric: 0
  });
}
```

#### 5.4 ARP for SVIs
- Switch must respond to ARP requests for SVI IPs
- ARP responses use the SVI's virtual MAC
- ARP table entries should reference the VLAN interface

### Tests for Phase 5

```typescript
describe('Phase 5: Inter-VLAN Routing via SVI', () => {
  describe('SVI IP Configuration', () => {
    it('should add connected route when SVI IP is configured');
    it('should respond to ARP for SVI IP address');
    it('should use SVI MAC in ARP reply');
  });

  describe('Inter-VLAN Packet Flow', () => {
    it('should route packet from VLAN 10 to VLAN 20');
    it('should decrement TTL when routing between VLANs');
    it('should ARP for destination in target VLAN');
    it('should drop packet if no route to destination VLAN');
  });

  describe('SVI as Gateway', () => {
    it('should accept packets destined to SVI MAC');
    it('should process packets for SVI IP at Layer 3');
    it('should forward routed packets with new L2 header');
  });
});
```

---

## Phase 6: Trunk Link Processing (802.1Q)

### Objective
Implement 802.1Q trunk link behavior for switch-to-switch and switch-to-router connections.

### Implementation Details

#### 6.1 Trunk Port Ingress Processing
When a frame arrives on a **trunk port**:

**Tagged Frame:**
1. Read VLAN tag from frame
2. Check if VLAN is in `allowedVlans`
3. If not allowed, drop the frame
4. Learn MAC with extracted VLAN ID

**Untagged Frame:**
1. Tag with `nativeVlan`
2. Learn MAC with native VLAN ID

```typescript
function processTrunkPortIngress(frame: Packet, port: NetworkInterface): Packet | null {
  let vlanId: number;
  
  if (frame.vlanTag) {
    // Tagged frame
    vlanId = frame.vlanTag;
    
    // Check if VLAN is allowed
    if (!port.allowedVlans?.includes(vlanId)) {
      return null; // Drop - VLAN not allowed on trunk
    }
  } else {
    // Untagged frame - use native VLAN
    vlanId = port.nativeVlan ?? 1;
    frame.vlanTag = vlanId;
  }
  
  learnMac(frame.sourceMAC, port.name, vlanId);
  return frame;
}
```

#### 6.2 Trunk Port Egress Processing
When sending a frame out a **trunk port**:

1. Check if frame's VLAN is in `allowedVlans`
2. If VLAN equals `nativeVlan`, send untagged
3. Otherwise, send with 802.1Q tag

```typescript
function processTrunkPortEgress(frame: Packet, port: NetworkInterface): Packet | null {
  const vlanId = frame.vlanTag ?? 1;
  
  // Check if VLAN is allowed
  if (!port.allowedVlans?.includes(vlanId)) {
    return null; // Drop
  }
  
  // Native VLAN - send untagged
  if (vlanId === port.nativeVlan) {
    delete frame.vlanTag;
  }
  // Else keep tag for 802.1Q
  
  return frame;
}
```

#### 6.3 VLAN Propagation Across Trunks
For switch-to-switch communication:
- Frame enters Switch A on access port (VLAN 10)
- Frame is tagged internally with VLAN 10
- Frame exits Switch A on trunk port (tagged if not native)
- Frame enters Switch B on trunk port
- Switch B processes based on tag
- Frame exits Switch B on access port (VLAN 10)

#### 6.4 Router-on-a-Stick (Subinterfaces)
For future enhancement - routers can have subinterfaces:
- `GigabitEthernet0/0.10` - Subinterface for VLAN 10
- `GigabitEthernet0/0.20` - Subinterface for VLAN 20

This allows a single physical link to carry multiple VLANs.

### Tests for Phase 6

```typescript
describe('Phase 6: Trunk Link Processing', () => {
  describe('Trunk Ingress', () => {
    it('should accept tagged frame if VLAN is allowed');
    it('should drop tagged frame if VLAN is not allowed');
    it('should tag untagged frame with native VLAN');
    it('should learn MAC with correct VLAN from trunk');
  });

  describe('Trunk Egress', () => {
    it('should send frame tagged on trunk port');
    it('should send frame untagged if VLAN is native');
    it('should drop frame if VLAN not in allowed list');
  });

  describe('Switch-to-Switch Trunk', () => {
    it('should forward frame across trunk maintaining VLAN');
    it('should isolate VLANs across trunk link');
    it('should flood in VLAN across trunk to remote switch');
  });

  describe('Native VLAN Handling', () => {
    it('should handle native VLAN mismatch gracefully');
    it('should tag native VLAN frames on egress when configured');
  });
});
```

---

## Implementation Order

### Phase 4 Implementation Steps
1. Write Phase 4 tests in `src/__tests__/vlan.test.ts`
2. Update `processSwitch()` in `src/lib/simulation.ts` to check VLAN on ingress
3. Update MAC learning to include VLAN
4. Update MAC lookup to filter by VLAN
5. Update flooding logic to respect VLAN boundaries
6. Run tests, iterate until all pass

### Phase 5 Implementation Steps
1. Write Phase 5 tests
2. Add SVI MAC address generation on SVI creation
3. Update `createDevice` for switches to initialize routing table
4. Implement SVI ARP response
5. Implement L3 packet processing for SVI-destined packets
6. Implement routing lookup and forwarding between VLANs
7. Run tests, iterate until all pass

### Phase 6 Implementation Steps
1. Write Phase 6 tests
2. Implement trunk ingress processing (tag handling)
3. Implement trunk egress processing (tag/untag decision)
4. Test with two switches connected via trunk
5. Run tests, iterate until all pass

---

## Files to Modify

| Phase | File | Changes |
|-------|------|---------|
| 4 | `src/lib/simulation.ts` | Update `processSwitch()` for VLAN-aware forwarding |
| 4 | `src/store/network-store.ts` | Update `learnMac()`, `lookupMac()` |
| 5 | `src/store/network-store.ts` | Add routing table to switches, SVI route management |
| 5 | `src/lib/simulation.ts` | Add L3 processing for SVI packets |
| 6 | `src/lib/simulation.ts` | Add trunk port tag handling |
| 6 | `src/types/network.ts` | Add `tagged` property to Packet if needed |
| All | `src/__tests__/vlan.test.ts` | Add test cases for each phase |

---

## Success Criteria

- [ ] Phase 4: Frames only forward within same VLAN on a single switch
- [ ] Phase 5: Packets can be routed between VLANs via SVI
- [ ] Phase 6: Tagged frames traverse trunk links correctly
- [ ] All tests pass (target: 50+ VLAN-related tests)
- [ ] No regressions in existing tests
