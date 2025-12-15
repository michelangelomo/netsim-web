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
