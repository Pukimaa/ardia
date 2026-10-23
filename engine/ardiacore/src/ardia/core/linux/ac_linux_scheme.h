// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_LINUX_AC_LINUX_SCHEME_H_
#define ARDIA_CORE_LINUX_AC_LINUX_SCHEME_H_

#include <optional>
#include <string>

#include "base/files/file_path.h"
#include "content/public/browser/content_browser_client.h"
#include "content/public/browser/frame_tree_node_id.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "services/network/public/mojom/url_loader_factory.mojom-forward.h"
#include "url/origin.h"

namespace ardia::linux_host {

inline constexpr char kShellScheme[] = "ardia";
inline constexpr char kShellHost[] = "shell";
inline constexpr char kNativeScheme[] = "ardia-native";

url::Origin ShellOrigin();
base::FilePath UIDirectory();
std::optional<std::string> DevServerURL();

mojo::PendingRemote<network::mojom::URLLoaderFactory>
CreateShellNavigationURLLoaderFactory(const std::string& scheme,
                                      content::FrameTreeNodeId frame_tree_node_id);

void RegisterShellSubresourceURLLoaderFactories(
    int render_process_id,
    int render_frame_id,
    const std::optional<url::Origin>& request_initiator_origin,
    content::ContentBrowserClient::NonNetworkURLLoaderFactoryMap* factories);

}

#endif
