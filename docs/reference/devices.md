# Device Types Reference

Complete reference for all network device types in NetSimWeb.

## End Devices

### PC
A standard desktop computer.

- **Interfaces**: 1 Ethernet port
- **Capabilities**: IP configuration, ping, basic networking
- **Use case**: Simulating end-user workstations

### Laptop
A portable computer.

- **Interfaces**: 1 Ethernet port, 1 Wireless (future)
- **Capabilities**: Same as PC
- **Use case**: Mobile end devices

### Server
A network server.

- **Interfaces**: 2+ Ethernet ports
- **Capabilities**: IP configuration, services
- **Use case**: Web servers, file servers, DNS, DHCP

## Network Infrastructure

### Router
Layer 3 routing device.

- **Interfaces**: Multiple Ethernet and Serial ports
- **Capabilities**: 
  - IP routing between networks
  - Static and dynamic routing
  - NAT (future)
  - Access control lists (future)
- **Use case**: Connecting different networks

### Switch
Layer 2 switching device.

- **Interfaces**: 8-24 Ethernet ports
- **Capabilities**:
  - MAC address learning
  - VLAN support (future)
  - Spanning Tree (future)
- **Use case**: Connecting devices in the same network

### Hub
Layer 1 repeater device.

- **Interfaces**: 4-8 Ethernet ports
- **Capabilities**:
  - Broadcasts all traffic to all ports
  - No intelligence or filtering
- **Use case**: Legacy network simulation, learning collision domains

## Security

### Firewall
Network security device.

- **Interfaces**: Multiple Ethernet ports (inside/outside)
- **Capabilities**:
  - Packet filtering
  - Access control
  - Zone-based security
- **Use case**: Network perimeter security

## Cloud

### Internet/Cloud
Represents external networks.

- **Interfaces**: 1+ connection points
- **Capabilities**:
  - Simulates internet connectivity
  - External network representation
- **Use case**: WAN connectivity, internet access simulation

## Interface Naming

| Device Type | Interface Names |
|-------------|-----------------|
| PC/Laptop | eth0 |
| Server | eth0, eth1 |
| Router | eth0, eth1, serial0 |
| Switch | fa0/1 - fa0/24 |
| Hub | port1 - port8 |
| Firewall | inside, outside, dmz |
