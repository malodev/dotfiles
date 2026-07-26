# Pi inference manager (GPU host)

This Stow package is installed only on the R9700 host. The manager is the sole owner of Studio/router mode transitions and grants one expiring team lease at a time.

The checked-in nginx file is a deployment template for certificate-verified HTTPS. The manager requires a dedicated high-entropy control bearer on every remote request; the model API uses a separate key. Validate the template with `nginx -t` and verify an unauthenticated request returns HTTP 401 before provisioning clients.
