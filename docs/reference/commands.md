# CLI Command Reference

Complete reference for all available terminal commands.

## General Commands

### help
Display available commands.
```
help
```

### clear
Clear the terminal screen.
```
clear
```

### exit
Exit current configuration mode or close terminal.
```
exit
```

## Show Commands

### show ip
Display IP address configuration.
```
show ip
show ip interface brief
```

### show interfaces
Display interface details.
```
show interfaces
show interfaces eth0
```

### show running-config
Display current configuration.
```
show running-config
```

### show arp
Display ARP table.
```
show arp
```

### show mac-address-table
Display MAC address table (switches only).
```
show mac-address-table
```

### show ip route
Display routing table (routers only).
```
show ip route
```

## Configuration Commands

### hostname
Set device hostname.
```
configure terminal
hostname MyDevice
```

### interface
Enter interface configuration mode.
```
interface eth0
```

### ip address
Configure IP address on interface.
```
interface eth0
ip address 192.168.1.1 255.255.255.0
```

### no shutdown
Enable an interface.
```
interface eth0
no shutdown
```

### shutdown
Disable an interface.
```
interface eth0
shutdown
```

## Routing Commands

### ip route
Add static route (routers only).
```
ip route 10.0.0.0 255.0.0.0 192.168.1.254
```

### ip default-gateway
Set default gateway (end devices).
```
ip default-gateway 192.168.1.1
```

## Diagnostic Commands

### ping
Test connectivity to an IP address.
```
ping 192.168.1.1
ping 192.168.1.1 count 5
```

### traceroute
Trace route to destination.
```
traceroute 10.0.0.1
```

### arp
Manage ARP cache.
```
arp -a
arp -d 192.168.1.1
```

### clear arp
Clear the ARP cache on the current device.
```
clear arp
```

### clear mac-address-table
Clear the MAC address table (switches only).
```
clear mac-address-table
```

## VLAN Commands

### vlan
Create a VLAN (switches only).
```
configure terminal
vlan 10
name Sales
exit
```

### no vlan
Delete a VLAN.
```
configure terminal
no vlan 10
```

### show vlan
Display VLAN information.
```
show vlan
show vlan brief
```

### switchport mode
Set interface switchport mode.
```
interface FastEthernet0/1
switchport mode access
```
```
interface GigabitEthernet0/0
switchport mode trunk
```

### switchport access vlan
Assign access port to a VLAN.
```
interface FastEthernet0/1
switchport mode access
switchport access vlan 10
```

### switchport trunk native vlan
Set the native VLAN for a trunk port.
```
interface GigabitEthernet0/0
switchport mode trunk
switchport trunk native vlan 1
```

### switchport trunk allowed vlan
Set allowed VLANs on a trunk port.
```
interface GigabitEthernet0/0
switchport trunk allowed vlan 1,10,20,30
```

### show interfaces trunk
Display trunk port information.
```
show interfaces trunk
```

## SVI Commands (Layer 3 Switches)

### interface vlan
Create and configure an SVI.
```
interface vlan 10
ip address 10.10.10.1 255.255.255.0
no shutdown
```

### no interface vlan
Remove an SVI.
```
no interface vlan 10
```

### show ip interface brief
Show all interfaces including SVIs.
```
show ip interface brief
```

## Spanning Tree Protocol (STP) Commands

### spanning-tree enable
Enable STP on a switch.
```
spanning-tree enable
```

### spanning-tree disable
Disable STP on a switch (all ports become forwarding).
```
spanning-tree disable
```

### spanning-tree priority
Set the bridge priority (0-61440, must be multiple of 4096). Lower priority = more likely to be root.
```
spanning-tree priority 4096
```

### spanning-tree cost
Set the path cost on a port (in interface configuration mode).
```
interface GigabitEthernet0/0
spanning-tree cost 100
```

### spanning-tree port-priority
Set the port priority (0-255). Lower priority = more likely to be root port.
```
interface GigabitEthernet0/0
spanning-tree port-priority 64
```

### spanning-tree reconverge
Force STP to recalculate the topology.
```
spanning-tree reconverge
```

### show spanning-tree
Display STP status including root bridge, bridge ID, timers, and whether this switch is root.
```
show spanning-tree
show stp
```

### show stp interface
Display per-port STP states, roles, costs, and priorities.
```
show stp interface
show spanning-tree interface
```

### show stp detail
Display detailed STP information for each port.
```
show stp detail
show spanning-tree detail
```

## TCP Connection Commands

### netstat
Display network connections and statistics. Shows TCP connection states.

```
netstat              # Show active connections
netstat -a           # Show all connections (including LISTEN)
netstat -l           # Show only listening ports
netstat -r           # Show routing table
netstat -i           # Show interface statistics
```

**Example Output:**
```
Active Internet connections
Proto Recv-Q Send-Q Local Address           Foreign Address         State
tcp    0      0 *:80                    *:*                     LISTEN
tcp    0      0 192.168.1.10:49152      192.168.1.100:80        ESTABLISHED
tcp    0      0 192.168.1.10:49153      192.168.1.200:443       TIME_WAIT
```

**TCP States:**
| State | Description |
|-------|-------------|
| LISTEN | Waiting for incoming connections |
| SYN_SENT | Connection request sent |
| SYN_RECV | Connection request received |
| ESTABLISHED | Active connection |
| FIN_WAIT_1 | Close initiated |
| FIN_WAIT_2 | Close acknowledged |
| TIME_WAIT | Waiting for timeout |
| CLOSE_WAIT | Remote side closed |
| LAST_ACK | Waiting for final ACK |
| CLOSED | Connection closed |

### telnet
Open a TCP connection to a remote host.

```
telnet <host> [port]
```

**Arguments:**
- `host` - Target IP address
- `port` - Target port (default: 23)

**Examples:**
```
telnet 192.168.1.100 80    # Connect to port 80
telnet 10.0.0.1            # Connect to default telnet port 23
```

**Output:**
```
Trying 192.168.1.100...
Connected to 192.168.1.100.
Escape character is '^]'.
```

### listen (GUI)
Start listening on a TCP port. Available through the Properties Panel:

1. Select a device (PC, Server, Router)
2. Expand "TCP Connections" section
3. Click "Listen on Port"
4. Enter port number (1-65535)
5. Click "Start Listening"

