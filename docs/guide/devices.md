# Adding Devices

Learn how to add and configure network devices in NetSimWeb.

## Drag and Drop

1. Find the device you want in the sidebar
2. Click and drag it onto the canvas
3. Release to place the device

## Available Devices

### End Devices

- **PC** - Desktop computer
- **Laptop** - Portable computer
- **Server** - Network server

### Network Devices

- **Router** - Layer 3 device for routing between networks
- **Switch** - Layer 2 device for local network switching
  - Supports VLANs (access and trunk ports)
  - Can be configured as Layer 3 switch with SVIs
- **Hub** - Basic Layer 1 repeater (broadcasts all traffic)

### Security & Cloud

- **Firewall** - Security device for filtering traffic
- **Cloud/Internet** - Represents external networks

## Device Properties

After placing a device, click on it to:

- Rename the device
- View and configure interfaces
- Access the device terminal
- Delete the device

### Switch-Specific Properties

Switches have additional configuration options:

- **VLANs** - Create and manage VLANs
- **SVIs** - Configure Layer 3 interfaces for inter-VLAN routing
- **MAC Table** - View learned MAC addresses
- **Interface VLAN Settings** - Configure access/trunk modes

## Tips

- Use meaningful names for devices (e.g., "MainRouter", "WebServer")
- Plan your topology before adding devices
- Group related devices together for clarity
