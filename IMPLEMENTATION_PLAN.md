# Network Simulator - Implementation Analysis & Plan

## Executive Summary

This document analyzes the current network simulator implementation, identifies implementation issues, and outlines missing features needed for a realistic network simulation. The codebase has a solid foundation but requires improvements in protocol accuracy, simulation fidelity, and feature completeness.


## IMPORTANT NOTE!

Every implementations must use TDD approach.

---

## Part 1: Implementation Issues (Bugs & Incorrect Behavior)

### 1.1 ARP Protocol Issues

#### ✅ FIXED: Hardcoded Interface in ARP Learning
**Location:** `src/lib/simulation.ts` line 687
**Solution:** Now uses `ingressInterface?.name || device.interfaces[0]?.name || 'eth0'`
**Status:** Fixed and tested in `phase1-fixes.test.ts`

#### ✅ FIXED: ARP Request Flooding on L2 Devices
**Location:** `src/lib/simulation.ts` - `processSwitchLogic`
**Solution:** Switches now properly flood broadcasts (including ARP requests) to all ports in the same VLAN except ingress.
**Status:** Working correctly with VLAN awareness.

#### ⏸️ DEFERRED: ARP Timeout/Aging
**Location:** `src/store/network-store.ts`
**Decision:** Automatic aging is intentionally disabled for better UX in a learning simulator. Users can manually clear tables via `clear arp` or `clear mac-address-table` commands, or tables are cleared when simulation stops.
**Status:** Design decision - not a bug.

---

### 1.2 Routing Issues

#### ✅ FIXED: TTL Not Decremented for Locally Generated Packets Correctly
**Location:** `src/lib/simulation.ts` lines 658-659, 982
**Solution:** Added explicit `isLocallyGenerated` flag to `Packet` type. TTL is only decremented when `isLocallyGenerated === false`.
**Status:** Fixed and tested in `phase1-fixes.test.ts`

#### ✅ FIXED: ICMP Destination Unreachable Not Implemented
**Location:** `src/lib/simulation.ts` lines 927-967
**Solution:** Now generates ICMP Type 3 Code 0 (Network Unreachable) when no route exists. Includes original packet info in payload.
**Status:** Fixed and tested in `phase1-fixes.test.ts`

#### ✅ FIXED: ICMP Time Exceeded
**Location:** `src/lib/simulation.ts` lines 846-884
**Solution:** Now generates ICMP Type 11 Code 0 (TTL Exceeded in Transit) when packet TTL reaches 1 at a router.
**Status:** Fixed and tested in `simulation.test.ts`

#### Issue: Connected Routes Not Automatically Added for All Device Types
**Location:** `src/store/network-store.ts`
**Problem:** Connected routes are only auto-added for routers and firewalls when configuring interfaces, but servers with routing capability won't get them.
**Impact:** Servers acting as routers won't have proper routing tables.
**Status:** Low priority - servers typically don't route.

---

### 1.3 Switch/L2 Issues

#### ⏸️ DEFERRED: MAC Table Aging Not Implemented
**Location:** `src/store/network-store.ts`
**Decision:** Same as ARP aging - intentionally disabled for learning simulator UX. Users can clear via `clear mac-address-table` command.
**Status:** Design decision - not a bug.

#### ✅ FIXED: VLAN Support is Incomplete
**Location:** `src/lib/simulation.ts`, `src/types/network.ts`
**Solution:** Complete 802.1Q VLAN implementation:
- Access vs trunk port modes with `vlanMode`, `accessVlan`, `allowedVlans`, `nativeVlan`
- VLAN tagging/untagging in `processEgressVlan()`
- VLAN-aware MAC learning in `processSwitchLogic()`
- SVI (Switch Virtual Interfaces) for inter-VLAN routing
- Comprehensive test coverage in `vlan.test.ts` (49 tests)
**Status:** Complete

#### Issue: STP (Spanning Tree Protocol) Not Implemented
**Location:** N/A
**Problem:** No loop prevention mechanism exists.
**Impact:** Network loops cause broadcast storms (infinite packet flooding).
**Status:** Still needed for realistic simulation.

---

### 1.4 Packet Processing Issues

#### ✅ MITIGATED: Placeholder MAC Detection is Fragile
**Location:** `src/lib/simulation.ts` line 661
**Solution:** The `isLocallyGenerated` flag now provides a more reliable way to detect packets that need routing. The placeholder MAC (`00:00:00:00:00:00`) is still used but combined with `isLocallyGenerated` check for robustness.
**Status:** Acceptable - works well in practice.

#### ✅ FIXED: Buffered Packets May Starve
**Location:** `src/store/network-store.ts` - `tick()` function
**Solution:** After processing all packets, the tick function now checks for awakened packets whose ARP has been resolved and transitions them from 'buffered' to 'at-device'.
**Status:** Fixed

#### ✅ FIXED: Packet Path History Not Updated
**Location:** `src/lib/simulation.ts` - `addToPath()` function
**Solution:** The `addToPath()` helper function now tracks packet traversal through devices. Called from `processSwitchLogic()`, `processHubLogic()`, and `processL3Logic()`.
**Status:** Fixed and tested in `phase1-fixes.test.ts`

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

#### ✅ FIXED: Firewall Rules Not Enforced
**Location:** `src/lib/simulation.ts` lines 36-111, 785-797
**Solution:** Full firewall rule evaluation implemented:
- `matchesIpPattern()` - supports 'any', exact match, and CIDR notation
- `matchesPortPattern()` - supports '*', 'any', exact match, and port ranges
- `matchesFirewallRule()` - evaluates rule against packet
- `evaluateFirewallRules()` - processes rule list with implicit deny at end
- Integrated into `processL3Logic()` for firewall devices
**Status:** Fixed and tested in `phase1-fixes.test.ts` (6 tests for firewall rules)

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

#### ✅ COMPLETE: VLAN Support
**Priority:** High
**Description:** IEEE 802.1Q VLAN tagging
**Components Implemented:**
- ✅ Access vs Trunk port modes (`vlanMode: 'access' | 'trunk'`)
- ✅ Native VLAN configuration (`nativeVlan`)
- ✅ VLAN tagging/untagging (`processEgressVlan()`, `getIngressVlan()`)
- ✅ Inter-VLAN routing via SVI (Switch Virtual Interfaces)
- ✅ VLAN-aware MAC learning and forwarding
**Status:** Complete - 49 tests in `vlan.test.ts`

#### 2.1.4 NAT (Network Address Translation)
**Priority:** High
**Description:** Source NAT, DNAT, PAT
**Components Needed:**
- NAT table structure
- Inside/Outside interface designation
- Static NAT rules
- Dynamic NAT with pools
- PAT (Port Address Translation)

#### ✅ COMPLETE: Firewall Rule Enforcement
**Priority:** High
**Description:** Stateless packet filtering (stateful inspection is future enhancement)
**Components Implemented:**
- ✅ Rule matching engine (protocol, source/dest IP, source/dest port)
- ✅ IP pattern matching (any, exact, CIDR)
- ✅ Port pattern matching (any, exact, ranges)
- ✅ Implicit deny at end of ruleset
- ☐ Connection tracking for stateful inspection (future)
- ☐ Logging of matched rules (future)
**Status:** Basic enforcement complete - 6 tests in `phase1-fixes.test.ts`

---

### 2.2 Important Missing Features

#### 2.2.1 Link Aggregation (LACP)
**Priority:** Medium
**Description:** IEEE 802.3ad link bundling
**Components Needed:**
- Port-channel interface type
- LACP negotiation packets
- Load balancing across member links

#### ✅ MOSTLY COMPLETE: ICMP Implementation
**Priority:** Medium
**Implemented:**
- ✅ Echo Request (Type 8) / Echo Reply (Type 0)
- ✅ Time Exceeded (Type 11 Code 0) - TTL expiry
- ✅ Destination Unreachable (Type 3 Code 0) - Network Unreachable
**Still Missing:**
- ☐ Destination Unreachable Code 1 (Host Unreachable)
- ☐ Destination Unreachable Code 3 (Port Unreachable)
- ☐ Redirect (Type 5)
- ☐ Parameter Problem (Type 12)

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

### ✅ Phase 1: Bug Fixes (COMPLETE)

#### Core Protocol Fixes - ALL DONE
1. ✅ **Fix ARP interface detection** - Uses `ingressInterface.name`
2. ⏸️ **ARP/MAC table aging** - Deferred (design decision for better UX)
3. ✅ **Fix packet path tracking** - `addToPath()` implemented
4. ✅ **Add explicit packet flags** - `isLocallyGenerated` added

#### Error Handling - ALL DONE
5. ✅ **ICMP Destination Unreachable** - Type 3 Code 0 implemented
6. ✅ **ICMP Time Exceeded** - Type 11 Code 0 implemented
7. ✅ **Fix buffered packet handling** - ARP wake-up in tick()
8. ✅ **Add firewall rule evaluation** - Full matching engine

---

### ✅ Phase 2: Core Feature Completion (PARTIAL)

#### L2 Improvements
9. ✅ **Complete VLAN support** - Full 802.1Q implementation with SVI
10. ☐ **Implement STP** - Still needed for loop prevention

#### TCP Foundation - NOT STARTED
11. ☐ **Implement TCP 3-way handshake**
12. ☐ **Implement TCP teardown**

#### NAT - NOT STARTED
13. ☐ **Implement basic NAT/PAT**

---

### Phase 3: Advanced Features (Future)

#### Protocol Enhancements
14. ☐ **DHCP DORA handshake** (optional - current instant DHCP works)
15. ☐ **DHCP relay agent**
16. ☐ **CDP/LLDP discovery**
17. ☐ **Port security on switches**

#### Routing & Filtering
18. ☐ **Simple RIP implementation**
19. ☐ **Extended firewall features** (stateful inspection)
20. ☐ **DNAT/PAT support**

---

## Part 4: Code Quality Improvements

### 4.1 Testing - ✅ COMPLETE
- ✅ Tests for firewall rule matching (6 tests in `phase1-fixes.test.ts`)
- ✅ Tests for VLAN handling (49 tests in `vlan.test.ts`)
- ✅ Integration tests for multi-hop routing (in `integration.test.ts`)
- ✅ Tests for error conditions (TTL expiry, unreachable in `simulation.test.ts`)
- **Total: 212 tests passing**

### 4.2 Performance Considerations
- ☐ MAC/ARP table lookups could use Maps for O(1) access (currently arrays)
- ☐ Consider packet batching for high-traffic simulations
- ☐ Implement simulation tick throttling for large networks

### 4.3 Code Organization (Future Refactoring)
- ☐ Extract protocol handlers into separate modules:
  - `protocols/arp.ts`
  - `protocols/icmp.ts`
  - `protocols/tcp.ts`
  - `protocols/dhcp.ts`
  - `protocols/stp.ts`
- ☐ Create protocol state machines as separate classes

### 4.4 Documentation
- ☐ Add JSDoc comments to all protocol functions
- ☐ Document packet flow through the system
- ☐ Create architecture diagram

---

## Part 5: Prioritized Task List

### Completed ✅

#### Phase 1: VLAN Support (Complete)
1. ✅ **Complete VLAN support**
   - Access/trunk port modes
   - 802.1Q VLAN tagging/untagging
   - VLAN-aware MAC learning
   - VLAN-aware forwarding
   - SVI (Switch Virtual Interfaces) for inter-VLAN routing
   - Trunk link processing

#### Phase 2: Core Protocol Fixes (Complete)
2. ✅ **Fix hardcoded ARP interface** - Uses `ingressInterface?.name`
3. ✅ **Packet path tracking** - `addToPath()` function implemented
4. ✅ **Explicit `isLocallyGenerated` flag** - Proper TTL handling
5. ✅ **ICMP Destination Unreachable** - Type 3 Code 0 (Network Unreachable)
6. ✅ **ICMP Time Exceeded** - Type 11 Code 0 (TTL expired)
7. ✅ **Firewall rule evaluation** - Full rule matching with implicit deny
8. ✅ **Buffered packet handling** - ARP wake-up mechanism in tick()
9. ✅ **Passive ARP learning** - Learn from IP packet source addresses

#### Phase 3: Testing Infrastructure (Complete)
10. ✅ **Comprehensive test suite** - 212 tests:
    - `network-utils.test.ts` - 48 tests (IP math, MAC, routing utilities)
    - `simulation.test.ts` - 24 tests (packet processing)
    - `phase1-fixes.test.ts` - 24 tests (bug fixes validation)
    - `vlan.test.ts` - 49 tests (VLAN functionality)
    - `network-store.test.ts` - 57 tests (store operations)
    - `integration.test.ts` - 10 tests (end-to-end flows)

#### Design Decisions
11. ✅ **ARP/MAC table aging disabled** - Intentional for learning simulator UX

### Immediate (Next Sprint)
1. ☐ **Implement STP** (basic loop prevention)
   - BPDU packet structure
   - Port states: Blocking, Forwarding
   - Root bridge election (simplified)

### Short-term (Next 2-3 Sprints)
2. ☐ **Implement TCP 3-way handshake**
   - SYN, SYN-ACK, ACK packet handling
   - Connection state tracking (`tcpConnections` array)
3. ☐ **Implement TCP teardown**
   - FIN, ACK handling
   - TIME_WAIT state

### Medium-term (Next Quarter)
4. ☐ **Implement NAT/PAT**
   - Source NAT (masquerade)
   - NAT table structure
   - Inside/Outside interface designation
5. ☐ **DHCP DORA sequence** (optional enhancement)
   - Currently instant; could simulate 4-way handshake packets
6. ☐ **Simple routing protocol (RIP)**
7. ☐ **CDP/LLDP discovery**

### Long-term (Future)
8. ☐ IPv6 support
9. ☐ QoS simulation
10. ☐ Wireless simulation
11. ☐ SNMP

---

## Appendix: File Reference

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/simulation.ts` | Core packet processing | ✅ ARP, TTL, ICMP errors all fixed |
| `src/store/network-store.ts` | State management | ✅ Buffered packets fixed, DHCP/DNS work |
| `src/lib/network-utils.ts` | Network utilities | ✅ All utilities working, 48 tests |
| `src/types/network.ts` | Type definitions | ✅ VLAN complete, TCP types ready for use |
| `src/lib/terminal-commands.ts` | CLI implementation | ✅ Good coverage |
| `src/__tests__/*.test.ts` | Test suites | ✅ 212 tests passing |

---

*Document generated: December 15, 2025*
*Last updated: December 15, 2025*
*Version: 2.0*

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
