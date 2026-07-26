# Pi inference manager (GPU host)

This Stow package is installed only on the R9700 host. The manager is the sole owner of Studio/router mode transitions and grants one expiring team lease at a time.

The checked-in nginx file is a deployment template that requires a private client CA, CRL, and per-client certificate in addition to the manager bearer token. Do not install it until those PKI files have been created and tested.
