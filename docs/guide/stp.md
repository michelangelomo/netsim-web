# Spanning Tree Protocol (STP) Guide

Learn how to configure Spanning Tree Protocol to prevent network loops in your switch topology.

## What is STP?

Spanning Tree Protocol (IEEE 802.1D) prevents Layer 2 loops in networks with redundant switch connections. Without STP, broadcast frames would loop indefinitely, causing a broadcast storm that brings down the network.

## How STP Works

1. **Root Bridge Election** - Switches elect one switch as the root based on Bridge ID (priority + MAC)
2. **Path Calculation** - Each switch calculates the best path to the root
3. **Port Role Assignment** - Ports are assigned roles (root, designated, alternate)
4. **Port State Management** - Blocking ports prevent loops while maintaining redundancy

## STP Port States

| State | Description |
|-------|-------------|
| **Disabled** | Port is administratively down |
| **Blocking** | Port blocks user traffic but receives BPDUs |
| **Listening** | Transitional state (not used in simulation) |
| **Learning** | Learning MAC addresses but not forwarding |
| **Forwarding** | Port forwards all traffic normally |

## STP Port Roles

| Role | Description |
|------|-------------|
| **Root Port** | Best path to root bridge (one per non-root switch) |
| **Designated Port** | Best port for a segment to reach root |
| **Alternate Port** | Backup path, currently blocking |
| **Disabled** | Port is down or STP disabled on it |

## Enabling STP

Open a switch terminal and enable STP:

```
spanning-tree enable
```

This initializes STP with default values:
- Bridge Priority: 32768
- Hello Time: 2 seconds
- Max Age: 20 seconds
- Forward Delay: 15 seconds

## Viewing STP Status

### Basic Status
```
show spanning-tree
```

Output shows:
- Whether STP is enabled
- Bridge ID and priority
- Root bridge information
- Root path cost
- Timer values

### Per-Port Status
```
show stp interface
```

Shows for each port:
- Role (root/designated/alternate/disabled)
- State (forwarding/blocking/disabled)
- Path cost
- Port priority

### Detailed Port Info
```
show stp detail
```

## Configuring Root Bridge

To make a switch the root bridge, lower its priority:

```
spanning-tree priority 4096
```

Valid priorities: 0 to 61440 (multiples of 4096)
Lower priority = more likely to become root

### Priority Values Guide
| Priority | Typical Use |
|----------|-------------|
| 0 | Forced root (highest priority) |
| 4096 | Primary root |
| 8192 | Secondary root |
| 32768 | Default |

## Configuring Port Cost

Path cost affects root path selection. Lower cost = preferred path.

Enter interface configuration mode first:
```
interface GigabitEthernet0/0
spanning-tree cost 10
```

### Default Path Costs (IEEE 802.1D-2004)
| Speed | Cost |
|-------|------|
| 10 Gbps | 2 |
| 1 Gbps | 4 |
| 100 Mbps | 19 |
| 10 Mbps | 100 |

## Configuring Port Priority

Port priority is used as a tiebreaker when multiple ports have equal cost:

```
interface GigabitEthernet0/0
spanning-tree port-priority 64
```

Valid values: 0-255 (default: 128)

## Disabling STP

To disable STP (not recommended in redundant topologies):

```
spanning-tree disable
```

⚠️ **Warning**: Disabling STP in a topology with loops will cause broadcast storms!

## Force Reconvergence

To manually trigger STP recalculation after topology changes:

```
spanning-tree reconverge
```

## Example: Triangle Topology

```
        [SW1] (Root)
       /      \
      /        \
   [SW2]------[SW3]
               ^ blocked
```

### Configuration

**SW1 (Root Bridge):**
```
spanning-tree enable
spanning-tree priority 4096
```

**SW2:**
```
spanning-tree enable
```

**SW3:**
```
spanning-tree enable
```

After convergence:
- SW1 is root (lowest priority)
- SW2 and SW3 have root ports pointing to SW1
- One port on the SW2-SW3 link is blocking

## Troubleshooting

### All Ports Blocking
- Check if `spanning-tree enable` was run
- Run `spanning-tree reconverge` to force recalculation
- Verify connections are up

### Unexpected Root Bridge
- Check bridge priorities with `show spanning-tree`
- Lower priority on desired root switch
- Remember: lower priority wins

### Traffic Not Flowing
- Check port states with `show stp interface`
- Verify blocking ports are expected
- Ensure at least one path exists through forwarding ports

### Topology Changes Not Detected
- Run `spanning-tree reconverge` manually
- Check that all switches have STP enabled
- Verify connections are properly established

## Related Commands

| Command | Description |
|---------|-------------|
| `spanning-tree enable` | Enable STP |
| `spanning-tree disable` | Disable STP |
| `spanning-tree priority <value>` | Set bridge priority |
| `spanning-tree cost <value>` | Set port cost |
| `spanning-tree port-priority <value>` | Set port priority |
| `spanning-tree reconverge` | Force recalculation |
| `show spanning-tree` | Display STP status |
| `show stp interface` | Display port states |
| `show stp detail` | Display detailed port info |
