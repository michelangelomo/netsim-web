# Network Simulator - Implementation Analysis & Plan

## Executive Summary

This document analyzes the current network simulator implementation, identifies implementation issues, and outlines missing features needed for a realistic network simulation. The codebase has a solid foundation but requires improvements in protocol accuracy, simulation fidelity, and feature completeness.

---

## Part 1: Implementation Issues (Bugs & Incorrect Behavior)

### 1.1 ARP Protocol Issues

#### Issue: Hardcoded Interface in ARP Learning
**Location:** `src/lib/simulation.ts` lines 258-265
```typescript
const entry: ArpEntry = {
    ipAddress: payload.senderIP,
    macAddress: packet.sourceMAC,
    interface: 'eth0', // TODO: deduce real interface  ← BUG
    type: 'dynamic',
    age: 0,
};
```
**Problem:** The interface is hardcoded to `'eth0'` instead of determining the actual ingress interface.
**Impact:** Incorrect ARP table entries on multi-interface devices (routers).
**Fix:** Use the `ingressInterface?.name` which is already computed above.

#### Issue: ARP Request Flooding on L2 Devices
**Location:** `src/lib/simulation.ts`
**Problem:** ARP requests sent as broadcast (`FF:FF:FF:FF:FF:FF`) should be flooded by switches to all ports except ingress, but the switch logic and ARP sending logic are not properly integrated.
**Impact:** ARP resolution may fail across switches in some topologies.

#### Issue: Missing ARP Timeout/Aging
**Location:** `src/types/network.ts`, `src/store/network-store.ts`
**Problem:** ARP entries have an `age` field but no mechanism ages or expires entries.
**Impact:** Stale ARP entries never expire, which is unrealistic.
**Fix:** Add a periodic timer in the simulation tick to age ARP entries and remove expired ones.

---

### 1.2 Routing Issues

#### Issue: TTL Not Decremented for Locally Generated Packets Correctly
**Location:** `src/lib/simulation.ts` lines 463-465
**Problem:** The `isLocallyGenerated` check relies on `!packet.lastDeviceId`, which may not be reliable in all scenarios.
**Impact:** TTL may be incorrectly decremented or not decremented.
**Recommendation:** Add an explicit `isLocallyGenerated` flag to packets.

#### Issue: ICMP Destination Unreachable Not Implemented
**Location:** `src/lib/simulation.ts`
**Problem:** When routing fails (no route to host), the packet is silently dropped instead of generating ICMP Destination Unreachable (Type 3).
**Impact:** Unrealistic behavior; real networks send ICMP errors.
**Fix:** Generate ICMP Type 3 Code 0 (Network Unreachable) or Code 1 (Host Unreachable) when appropriate.

#### Issue: Connected Routes Not Automatically Added for All Device Types
**Location:** `src/store/network-store.ts` lines 541-551
**Problem:** Connected routes are only auto-added for routers and firewalls when configuring interfaces, but servers with routing capability won't get them.
**Impact:** Servers acting as routers won't have proper routing tables.

---

### 1.3 Switch/L2 Issues

#### Issue: MAC Table Aging Not Implemented
**Location:** `src/lib/simulation.ts`, `src/store/network-store.ts`
**Problem:** MAC table entries have an `age` field but entries never age out.
**Impact:** MAC tables grow indefinitely and never reflect network changes.
**Fix:** Add aging mechanism (default 300 seconds) and remove stale entries.

#### Issue: VLAN Support is Incomplete
**Location:** `src/types/network.ts`, `src/lib/simulation.ts`
**Problem:** VLAN field exists on interfaces and MAC table entries, but:
- No VLAN tagging/untagging logic
- No trunk/access port distinction
- No 802.1Q frame handling
**Impact:** VLANs are non-functional despite UI presence.

#### Issue: STP (Spanning Tree Protocol) Not Implemented
**Location:** N/A
**Problem:** No loop prevention mechanism exists.
**Impact:** Network loops cause broadcast storms (infinite packet flooding).
**Severity:** Critical for realistic simulation.

---

### 1.4 Packet Processing Issues

#### Issue: Placeholder MAC Detection is Fragile
**Location:** `src/lib/simulation.ts` lines 241-242
```typescript
const isPlaceholderMAC = packet.destMAC === '00:00:00:00:00:00';
```
**Problem:** Using `00:00:00:00:00:00` as a placeholder is a workaround for the packet generation flow.
**Impact:** May conflict with actual null MAC scenarios.
**Fix:** Add a proper `needsRouting` or `isOutbound` flag to packets.

#### Issue: Buffered Packets May Starve
**Location:** `src/store/network-store.ts` lines 660-675
**Problem:** Buffered packets waiting for ARP only get checked once per tick. If ARP resolution completes but the packet processing order misses it, packets may wait longer than necessary.
**Impact:** Increased latency for packets requiring ARP.

#### Issue: Packet Path History Not Updated
**Location:** `src/lib/simulation.ts`
**Problem:** Packets have `path: string[]` and `currentPathIndex` fields but these are never populated during simulation.
**Impact:** Debugging and visualization of packet paths is broken.

---

### 1.5 DHCP Issues

#### Issue: DHCP Discovery/Offer/Request/Ack Not Simulated
**Location:** `src/store/network-store.ts` lines 1145-1235
**Problem:** DHCP is implemented as an instant request-response without simulating the actual DORA (Discover, Offer, Request, Ack) handshake.
**Impact:** Unrealistic DHCP visualization; doesn't show the 4-way handshake.
**Fix:** Implement proper DHCP state machine with packet simulation.

#### Issue: DHCP Relay Not Implemented
**Location:** N/A
**Problem:** DHCP only works within the same L2 broadcast domain; no relay agent functionality.
**Impact:** Cannot simulate DHCP across routed networks.

---

### 1.6 DNS Issues

#### Issue: DNS Resolution is Synchronous/Instant
**Location:** `src/store/network-store.ts` lines 1460-1510
**Problem:** DNS resolution bypasses network simulation entirely; it directly queries the store.
**Impact:** DNS packets are created for visualization but resolution doesn't wait for them.
**Fix:** Make DNS resolution async and wait for actual DNS response packets.

#### Issue: No DNS Caching
**Location:** N/A
**Problem:** Every DNS lookup queries from scratch; no TTL-based caching.
**Impact:** Unrealistic DNS behavior.

---

### 1.7 TCP Issues

#### Issue: TCP State Machine Not Implemented
**Location:** `src/types/network.ts` has `TcpConnection` type but unused
**Problem:** TCP connections are defined but:
- No 3-way handshake simulation
- No connection tracking
- No sequence number handling
- No congestion control
**Impact:** TCP is non-functional; only ICMP/ARP work.

---

### 1.8 Firewall Issues

#### Issue: Firewall Rules Not Enforced
**Location:** `src/lib/simulation.ts`
**Problem:** Firewall rules exist in device config but `processL3Logic` doesn't check them.
**Impact:** Firewalls behave as routers; no packet filtering.
**Fix:** Add firewall rule evaluation in packet processing path.

---

## Part 2: Missing Features for Realistic Simulation

### 2.1 Critical Missing Features

#### 2.1.1 Spanning Tree Protocol (STP)
**Priority:** Critical
**Description:** IEEE 802.1D STP to prevent L2 loops
**Components Needed:**
- BPDU packet type
- Port states: Blocking, Listening, Learning, Forwarding
- Root bridge election
- Port role assignment (Root, Designated, Blocked)
- Topology change detection

#### 2.1.2 TCP Connection Simulation
**Priority:** High
**Description:** Full TCP state machine
**Components Needed:**
- 3-way handshake (SYN, SYN-ACK, ACK)
- 4-way teardown (FIN, ACK, FIN, ACK)
- Sequence/acknowledgment number tracking
- Connection table management
- Retransmission timeout (simplified)

#### 2.1.3 Complete VLAN Support
**Priority:** High
**Description:** IEEE 802.1Q VLAN tagging
**Components Needed:**
- Access vs Trunk port modes
- Native VLAN configuration
- VLAN tagging/untagging
- Inter-VLAN routing on routers

#### 2.1.4 NAT (Network Address Translation)
**Priority:** High
**Description:** Source NAT, DNAT, PAT
**Components Needed:**
- NAT table structure
- Inside/Outside interface designation
- Static NAT rules
- Dynamic NAT with pools
- PAT (Port Address Translation)

#### 2.1.5 Firewall Rule Enforcement
**Priority:** High
**Description:** Stateful packet inspection
**Components Needed:**
- Rule matching engine
- Connection tracking for stateful inspection
- Implicit deny at end of ruleset
- Logging of matched rules

---

### 2.2 Important Missing Features

#### 2.2.1 Link Aggregation (LACP)
**Priority:** Medium
**Description:** IEEE 802.3ad link bundling
**Components Needed:**
- Port-channel interface type
- LACP negotiation packets
- Load balancing across member links

#### 2.2.2 ICMP Complete Implementation
**Priority:** Medium
**Current State:** Only Echo Request/Reply and Time Exceeded
**Missing:**
- Destination Unreachable (Type 3) - all codes
- Redirect (Type 5)
- Parameter Problem (Type 12)

#### 2.2.3 Dynamic Routing Protocols
**Priority:** Medium
**Description:** RIP, OSPF, or simplified distance-vector
**Components Needed:**
- Routing protocol packets
- Neighbor discovery
- Route advertisement
- Route convergence

#### 2.2.4 DHCP Relay Agent
**Priority:** Medium
**Description:** Forward DHCP across subnets
**Components Needed:**
- Relay agent configuration on router interfaces
- GIADDR field handling
- Option 82 (circuit ID)

#### 2.2.5 CDP/LLDP (Discovery Protocols)
**Priority:** Medium
**Description:** Cisco Discovery Protocol / Link Layer Discovery Protocol
**Components Needed:**
- CDP packet type (already in types but unused)
- Periodic announcements
- Neighbor table

#### 2.2.6 Port Security
**Priority:** Medium
**Description:** MAC-based port security on switches
**Components Needed:**
- Maximum MAC addresses per port
- Violation modes (shutdown, restrict, protect)
- Sticky MAC learning

---

### 2.3 Nice-to-Have Features

#### 2.3.1 QoS (Quality of Service)
**Priority:** Low
**Description:** Traffic prioritization
**Components Needed:**
- DSCP/CoS marking
- Queue management
- Traffic shaping

#### 2.3.2 IPv6 Support
**Priority:** Low
**Description:** Full IPv6 stack
**Components Needed:**
- IPv6 address handling
- NDP (Neighbor Discovery Protocol)
- IPv6 routing
- Dual-stack support

#### 2.3.3 Wireless Simulation
**Priority:** Low
**Description:** WiFi access points and clients
**Components Needed:**
- AP device type
- SSID configuration
- WPA authentication simulation
- Wireless-to-wired bridging

#### 2.3.4 ACL (Access Control Lists)
**Priority:** Low
**Description:** Standard and Extended ACLs
**Components Needed:**
- ACL rule structure
- Interface binding (in/out)
- Named vs numbered ACLs

#### 2.3.5 SNMP Simulation
**Priority:** Low
**Description:** Network management protocol
**Components Needed:**
- MIB structure
- GET/SET operations
- Trap generation

---

## Part 3: Implementation Plan

### Phase 1: Bug Fixes (1-2 weeks)

#### Week 1: Core Protocol Fixes
1. **Fix ARP interface detection** (1 day)
   - Use `ingressInterface.name` instead of hardcoded `'eth0'`
   
2. **Implement ARP/MAC table aging** (2 days)
   - Add aging counter increment in simulation tick
   - Remove entries exceeding timeout (ARP: 300s, MAC: 300s)
   
3. **Fix packet path tracking** (1 day)
   - Update `packet.path` array as packet traverses devices
   
4. **Add explicit packet flags** (1 day)
   - Add `isLocallyGenerated` flag
   - Remove placeholder MAC workaround

#### Week 2: Error Handling
5. **Implement ICMP Destination Unreachable** (2 days)
   - Type 3 Code 0: Network Unreachable
   - Type 3 Code 1: Host Unreachable
   - Type 3 Code 3: Port Unreachable
   
6. **Fix buffered packet handling** (1 day)
   - Improve ARP resolution wakeup mechanism
   
7. **Add firewall rule evaluation** (2 days)
   - Check rules in `processL3Logic`
   - Implement match logic for all rule fields

---

### Phase 2: Core Feature Completion (2-3 weeks)

#### Week 3: L2 Improvements
8. **Implement STP** (5 days)
   - BPDU packet structure
   - Port state machine
   - Root bridge election
   - Basic topology management

#### Week 4: TCP Foundation
9. **Implement TCP 3-way handshake** (3 days)
   - SYN, SYN-ACK, ACK packet handling
   - Connection state tracking
   
10. **Implement TCP teardown** (2 days)
    - FIN, ACK handling
    - TIME_WAIT state

#### Week 5: VLAN & NAT
11. **Complete VLAN support** (3 days)
    - Access/trunk port configuration
    - 802.1Q tag handling
    - Inter-VLAN routing
    
12. **Implement basic NAT** (2 days)
    - Source NAT (masquerade)
    - NAT table structure

---

### Phase 3: Advanced Features (3-4 weeks)

#### Week 6-7: Protocol Enhancements
13. **DHCP DORA handshake** (2 days)
14. **DHCP relay agent** (1 day)
15. **DNS query simulation** (2 days)
16. **CDP/LLDP discovery** (2 days)
17. **Port security on switches** (2 days)

#### Week 8-9: Routing & Filtering
18. **Simple RIP implementation** (3 days)
19. **Extended firewall features** (2 days)
    - Stateful inspection
    - Connection tracking
20. **DNAT/PAT support** (2 days)

---

## Part 4: Code Quality Improvements

### 4.1 Testing Gaps
- Add tests for firewall rule matching
- Add tests for VLAN handling
- Add integration tests for multi-hop routing scenarios
- Add tests for error conditions (TTL expiry, unreachable)

### 4.2 Performance Considerations
- MAC/ARP table lookups should use Maps for O(1) access
- Consider packet batching for high-traffic simulations
- Implement simulation tick throttling for large networks

### 4.3 Code Organization
- Extract protocol handlers into separate modules:
  - `protocols/arp.ts`
  - `protocols/icmp.ts`
  - `protocols/tcp.ts`
  - `protocols/dhcp.ts`
  - `protocols/stp.ts`
- Create protocol state machines as separate classes

### 4.4 Documentation
- Add JSDoc comments to all protocol functions
- Document packet flow through the system
- Create architecture diagram

---

## Part 5: Prioritized Task List

### Completed ✅
1. ✅ **Complete VLAN support** (Phases 1-6)
   - Access/trunk port modes
   - 802.1Q VLAN tagging/untagging
   - VLAN-aware MAC learning
   - VLAN-aware forwarding
   - SVI (Switch Virtual Interfaces) for inter-VLAN routing
   - Trunk link processing
   - UI for VLAN management

### Immediate (This Sprint)
1. ☐ Fix hardcoded ARP interface
2. ☐ Implement ARP table aging
3. ☐ Implement MAC table aging
4. ☐ Add ICMP Destination Unreachable
5. ☐ Fix packet path tracking

### Short-term (Next 2 Sprints)
6. ☐ Implement firewall rule enforcement
7. ☐ Implement STP (at least basic loop prevention)
8. ☐ Implement TCP handshake

### Medium-term (Next Quarter)
9. ☐ Implement NAT/PAT
10. ☐ Implement DHCP DORA sequence
11. ☐ Add simple routing protocol (RIP)
12. ☐ Add CDP/LLDP

### Long-term (Future)
13. ☐ IPv6 support
14. ☐ QoS simulation
15. ☐ Wireless simulation
16. ☐ SNMP

---

## Appendix: File Reference

| File | Purpose | Issues Found |
|------|---------|--------------|
| `src/lib/simulation.ts` | Core packet processing | ARP interface, TTL handling, missing ICMP errors |
| `src/store/network-store.ts` | State management | DHCP instant, DNS sync, buffered packet handling |
| `src/lib/network-utils.ts` | Network utilities | None significant |
| `src/types/network.ts` | Type definitions | TCP types unused, VLAN incomplete |
| `src/lib/terminal-commands.ts` | CLI implementation | Good coverage |

---

*Document generated: December 15, 2025*
*Version: 1.1*

---

## Appendix B: Example Topologies

The `examples/` directory contains pre-built network topologies for learning and testing:

| Example | Description | Concepts |
|---------|-------------|----------|
| `simple-two-pcs.json` | Two PCs connected via switch | Basic switching, ARP, ping |
| `vlan-segmentation.json` | VLAN-based network isolation | VLANs, access ports, L2 segmentation |
| `inter-vlan-routing.json` | L3 switch with SVIs | SVI, inter-VLAN routing |
| `trunk-links.json` | Multi-switch with trunks | 802.1Q trunking, VLAN spanning |
| `multi-router-network.json` | Enterprise with branches | Static routing, DHCP, multi-hop |
| `dhcp-server.json` | DHCP server configuration | DHCP pools, address assignment |

See `examples/README.md` for detailed documentation on each topology.
