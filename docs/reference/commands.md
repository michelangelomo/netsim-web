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
