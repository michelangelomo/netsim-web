```markdown
# VLAN Configuration Guide

Learn how to configure VLANs (Virtual Local Area Networks) to segment your network traffic.

## What are VLANs?

VLANs allow you to logically segment a physical network into multiple broadcast domains. Devices in different VLANs cannot communicate directly without a Layer 3 device (router or L3 switch).

## VLAN Benefits

- 🔒 **Security** - Isolate sensitive traffic
- 📊 **Performance** - Reduce broadcast traffic
- 🔧 **Flexibility** - Group devices logically, not physically
- 🏢 **Organization** - Separate departments or functions

## Configuring VLANs

### Creating VLANs (Switch)

Open the switch terminal and create VLANs:

```
configure terminal
vlan 10
name Sales
exit
vlan 20
name Engineering
exit
```

### Viewing VLANs

```
show vlan
show vlan brief
```

### Deleting VLANs

```
configure terminal
no vlan 10
```

## Switchport Modes

### Access Ports

Access ports belong to a single VLAN and connect to end devices (PCs, servers).

```
interface FastEthernet0/1
switchport mode access
switchport access vlan 10
```

### Trunk Ports

Trunk ports carry multiple VLANs between switches. Traffic is tagged with 802.1Q headers.

```
interface GigabitEthernet0/0
switchport mode trunk
switchport trunk native vlan 1
switchport trunk allowed vlan 1,10,20,30
```

## Inter-VLAN Routing

Devices in different VLANs need a Layer 3 device to communicate.

### Option 1: Router-on-a-Stick

Use a router with subinterfaces:

```
interface GigabitEthernet0/0.10
encapsulation dot1q 10
ip address 10.10.10.1 255.255.255.0

interface GigabitEthernet0/0.20
encapsulation dot1q 20
ip address 10.20.20.1 255.255.255.0
```

### Option 2: SVI (Switch Virtual Interface)

Use a Layer 3 switch with SVIs:

```
interface vlan 10
ip address 10.10.10.1 255.255.255.0
no shutdown

interface vlan 20
ip address 10.20.20.1 255.255.255.0
no shutdown
```

!!! tip "SVI MAC Address"
    Each SVI has its own MAC address for ARP resolution.

## UI Configuration

You can also configure VLANs through the Properties Panel:

1. Select a switch
2. Find the **VLANs** section
3. Click **Add VLAN** and enter ID and name
4. For interfaces, configure:
   - **Mode**: Access or Trunk
   - **Access VLAN**: VLAN ID for access ports
   - **Native VLAN**: Untagged VLAN for trunks
   - **Allowed VLANs**: Comma-separated list for trunks

## Example: Department Segmentation

```
        [Core Switch]
       /      |      \
    VLAN 10  VLAN 20  VLAN 30
    Sales    Eng      Admin
     |        |        |
   [SW1]    [SW2]    [SW3]
   /  \     /  \     /  \
 PC1  PC2  PC3  PC4  PC5  PC6
```

### Configuration

**Core Switch (with SVIs):**
```
vlan 10
name Sales
vlan 20
name Engineering
vlan 30
name Admin

interface vlan 10
ip address 10.10.10.1 255.255.255.0
interface vlan 20
ip address 10.20.20.1 255.255.255.0
interface vlan 30
ip address 10.30.30.1 255.255.255.0

interface GigabitEthernet0/0
switchport mode trunk
switchport trunk allowed vlan 10,20,30
```

**Access Switches:**
```
interface FastEthernet0/1
switchport mode access
switchport access vlan 10
interface FastEthernet0/2
switchport mode access
switchport access vlan 10
```

## Troubleshooting

### VLAN Mismatch
- Ensure access ports have the correct VLAN assigned
- Check trunk allowed VLANs include all needed VLANs

### No Inter-VLAN Communication
- Verify SVI or router subinterface is configured
- Check default gateway on end devices
- Verify routing table entries

### Trunk Not Passing Traffic
- Both ends must be configured as trunk
- Check allowed VLANs on both sides
- Verify native VLAN matches

## Related Commands

| Command | Description |
|---------|-------------|
| `show vlan` | Display all VLANs |
| `show vlan brief` | Display VLAN summary |
| `show interfaces trunk` | Display trunk information |
| `show mac address-table vlan 10` | Show MAC table for VLAN 10 |

```
